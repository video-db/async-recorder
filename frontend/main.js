const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const net = require('net');
const { CaptureClient } = require('videodb/capture');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// --- In-process server modules (replaces Python backend) ---
const { initDatabase, closeDatabase, findUserByToken, findUserByApiKey, createUser, getRecordings: dbGetRecordings, getRecordingById } = require('./server/database');
const { VideoDBService } = require('./server/videodb-service');
const { TunnelManager } = require('./server/tunnel');
const { createServer } = require('./server/index');

let mainWindow;
let cameraWindow;

// CaptureClient instance (created per session)
let captureClient = null;

// In-process services
let db = null;
let videodbService = null;
let tunnelManager = null;
let expressServer = null;
let serverPort = null;
let webhookUrl = null;

// Configuration
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DB_FILE = path.join(app.getPath('userData'), 'async-recorder.db');
const AUTH_CONFIG_FILE = path.join(__dirname, '..', 'auth_config.json');

let appConfig = {
  accessToken: null,
  userName: null
};

// Session token cache (valid for 24 hours)
let cachedSessionToken = null;
let tokenExpiresAt = null;

// 1. Load User Config (Persistent Auth)
function loadUserConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      appConfig = { ...appConfig, ...savedConfig };
      console.log('Loaded user config (Auth) from:', CONFIG_FILE);
    }
  } catch (error) {
    console.error('Error loading user config:', error);
  }
}

function saveUserConfig(newConfig) {
  appConfig = { ...appConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2));
    console.log('User config saved:', CONFIG_FILE);
    return true;
  } catch (err) {
    console.error('Error saving user config:', err);
    return false;
  }
}

/**
 * Find an available port starting from the given port number.
 */
function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * Look up the current user's API key from the database using appConfig.accessToken.
 */
function getCurrentUserApiKey() {
  if (!appConfig.accessToken) return null;
  const user = findUserByToken(appConfig.accessToken);
  return user ? user.api_key : null;
}

/**
 * Look up the current user from the database.
 */
function getCurrentUser() {
  if (!appConfig.accessToken) return null;
  return findUserByToken(appConfig.accessToken);
}

// 2. Auto-register from auth_config.json (created by npm run setup or manual file)
async function autoRegisterFromSetup() {
  if (!fs.existsSync(AUTH_CONFIG_FILE)) {
    return;
  }

  try {
    const authConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    const { apiKey, name } = authConfig;

    if (!apiKey) {
      console.log('No API key in auth_config.json');
      fs.unlinkSync(AUTH_CONFIG_FILE);
      return;
    }

    console.log(`Registering from setup: ${name || 'Guest'}`);

    // Verify API key directly with VideoDB SDK
    const valid = await videodbService.verifyApiKey(apiKey);
    if (!valid) {
      console.error('Registration failed: Invalid API key');
      fs.unlinkSync(AUTH_CONFIG_FILE);
      appConfig.accessToken = null;
      saveUserConfig({ accessToken: null, userName: null });
      console.log('Invalid credentials - please re-enter in onboarding');
      return;
    }

    // Create or update user in local DB
    const existingUser = findUserByApiKey(apiKey);
    let accessToken;
    let userName = name || 'Guest';

    if (existingUser) {
      accessToken = existingUser.access_token;
      userName = existingUser.name;
    } else {
      accessToken = randomUUID();
      createUser(userName, apiKey, accessToken);
    }

    console.log('Registration successful!');
    saveUserConfig({ accessToken, userName });

    // Delete auth_config.json after successful registration
    fs.unlinkSync(AUTH_CONFIG_FILE);
    console.log('Setup complete - auth_config.json removed');

  } catch (error) {
    console.error('Registration error:', error);
    if (fs.existsSync(AUTH_CONFIG_FILE)) {
      fs.unlinkSync(AUTH_CONFIG_FILE);
    }
  }
}

// Initialize everything on app ready
async function initializeApp() {
  try {
    // 1. Initialize database
    console.log('Initializing database at:', DB_FILE);
    db = await initDatabase(DB_FILE);

    // 2. Create VideoDB service
    const apiUrl = process.env.VIDEODB_API_URL || null;
    videodbService = new VideoDBService({ baseUrl: apiUrl });

    // 3. Load user config
    loadUserConfig();

    // 4. Auto-register if setup was run
    await autoRegisterFromSetup();

    // 5. Start Express server for webhooks
    const startPort = parseInt(process.env.API_PORT, 10) || 8000;
    serverPort = await findAvailablePort(startPort);

    tunnelManager = new TunnelManager();
    const expressApp = createServer({ database: db, videodbService, tunnelManager });
    expressServer = expressApp.listen(serverPort, () => {
      console.log(`Express webhook server listening on port ${serverPort}`);
    });

    // 6. Start Cloudflare tunnel
    const envWebhookUrl = process.env.WEBHOOK_URL || null;
    webhookUrl = await tunnelManager.start(serverPort, envWebhookUrl);
    if (webhookUrl) {
      console.log(`Webhook URL: ${webhookUrl}`);
    } else {
      console.warn('Tunnel not available - webhooks will not work');
    }

    console.log('VideoDB SDK Configuration:');
    console.log('- AUTH_STATUS:', appConfig.accessToken ? 'Connected' : 'Needs Connection');
    console.log('- SERVER_PORT:', serverPort);
    console.log('- WEBHOOK_URL:', webhookUrl);
    console.log('App ready (CaptureClient will be created per session)');
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

// Setup event listeners on the CaptureClient instance
function setupCaptureClientEvents(client) {
  const events = ['recording:started', 'recording:stopped', 'recording:error', 'upload:progress', 'upload:complete', 'error'];
  for (const eventName of events) {
    client.on(eventName, (data) => {
      console.log(`SDK Event: ${eventName}`, data);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recorder-event', { event: eventName, data });
      }
    });
  }
}

// Helper function to get or generate session token (direct SDK call, no HTTP)
async function getSessionToken() {
  // Check if we have a valid cached token
  if (cachedSessionToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    console.log('Using cached session token (expires in', Math.round((tokenExpiresAt - Date.now()) / 1000 / 60), 'minutes)');
    return cachedSessionToken;
  }

  const apiKey = getCurrentUserApiKey();
  if (!apiKey) {
    console.warn('No API key available. Please register first.');
    return null;
  }

  try {
    console.log('Generating session token via VideoDB SDK...');
    const tokenData = await videodbService.generateSessionToken(apiKey);
    if (tokenData && tokenData.sessionToken) {
      cachedSessionToken = tokenData.sessionToken;
      const expiresInMs = (tokenData.expiresIn || 3600) * 1000;
      tokenExpiresAt = Date.now() + expiresInMs - (5 * 60 * 1000); // 5 min buffer
      return cachedSessionToken;
    }
  } catch (error) {
    console.error('Error generating session token:', error);
  }
  return null;
}

// --- IPC Handlers ---

ipcMain.handle('recorder-start-recording', async (event, clientSessionId, config) => {
  try {
    console.log(`Starting recording (client reference: ${clientSessionId})`);

    const accessToken = appConfig.accessToken;
    if (!accessToken) {
      console.error('Not authenticated');
      return { success: false, error: 'Not authenticated. Please register first.' };
    }

    const user = getCurrentUser();
    if (!user) {
      return { success: false, error: 'User not found. Please register first.' };
    }

    // 1. Create capture session directly via VideoDB SDK
    console.log('Creating capture session via SDK...');
    let captureSessionId;
    try {
      const callbackUrl = webhookUrl || null;
      const sessionData = await videodbService.createCaptureSession(user.api_key, {
        endUserId: `user-${user.id}`,
        callbackUrl,
        metadata: { clientSessionId, startedAt: Date.now() },
      });
      captureSessionId = sessionData.sessionId;
      console.log(`Capture session created: ${captureSessionId}`);
    } catch (err) {
      console.error('Error creating capture session:', err);
      return { success: false, error: 'Failed to create capture session: ' + err.message };
    }

    // 2. Get session token (from cache or generate new one)
    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      console.error('Failed to get session token');
      return { success: false, error: 'Failed to get session token. Please register first.' };
    }

    // 3. Create a new CaptureClient instance
    const captureOptions = { sessionToken };
    if (process.env.VIDEODB_API_URL) {
      captureOptions.apiUrl = process.env.VIDEODB_API_URL;
    }
    console.log('Creating CaptureClient', captureOptions);

    captureClient = new CaptureClient(captureOptions);
    setupCaptureClientEvents(captureClient);

    // 4. List available channels
    console.log('Listing available channels...');
    let channels;
    try {
      channels = await captureClient.listChannels();
      for (const ch of channels.all()) {
        console.log(`  - ${ch.id} (${ch.type}): ${ch.name}`);
      }
    } catch (err) {
      console.error('Failed to list channels:', err);
      return { success: false, error: 'Failed to list capture channels' };
    }

    // 5. Select channels for capture
    const captureChannels = [];

    const micChannel = channels.mics.default;
    if (micChannel) {
      captureChannels.push({ channelId: micChannel.id, type: 'audio', store: true });
      console.log(`Selected mic channel: ${micChannel.id}`);
    }

    const systemAudioChannel = channels.systemAudio.default;
    if (systemAudioChannel) {
      captureChannels.push({ channelId: systemAudioChannel.id, type: 'audio', store: true });
      console.log(`Selected system audio channel: ${systemAudioChannel.id}`);
    }

    const displayChannel = channels.displays.default;
    if (displayChannel) {
      captureChannels.push({ channelId: displayChannel.id, type: 'video', store: true });
      console.log(`Selected display channel: ${displayChannel.id}`);
    }

    if (captureChannels.length === 0) {
      console.error('No capture channels available');
      return { success: false, error: 'No capture channels available. Check permissions.' };
    }

    // 6. Start capture session
    console.log('Starting capture session with options:', JSON.stringify({
      sessionId: captureSessionId,
      channels: captureChannels
    }, null, 2));

    await captureClient.startSession({
      sessionId: captureSessionId,
      channels: captureChannels,
    });

    console.log('Capture session started successfully');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:started',
        data: { sessionId: captureSessionId }
      });
    }

    return { success: true, sessionId: captureSessionId };
  } catch (error) {
    console.error('Error starting recording:', error);
    return { success: false, error: error.message };
  }
});

// Check Tunnel Status Handler (direct, no HTTP)
ipcMain.handle('check-tunnel-status', async () => {
  return {
    active: tunnelManager ? tunnelManager.isRunning() : false,
    webhook_url: tunnelManager ? tunnelManager.getWebhookUrl() : null,
    provider: 'cloudflare',
  };
});

// Open External Link
ipcMain.handle('open-external-link', async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('recorder-stop-recording', async (event, sessionId) => {
  try {
    console.log(`Stopping recording for session: ${sessionId}`);

    if (captureClient) {
      await captureClient.stopSession();
      console.log('Capture session stopped');

      try {
        await captureClient.shutdown();
        console.log('CaptureClient shutdown complete');
      } catch (shutdownErr) {
        console.warn('CaptureClient shutdown warning:', shutdownErr.message);
      }
      captureClient = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recorder-event', {
          event: 'recording:stopped',
          data: { sessionId }
        });
      }
    } else {
      console.warn('No active capture client to stop');
    }

    return { success: true };
  } catch (error) {
    console.error('Error stopping recording:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recorder-pause-tracks', async (event, sessionId, tracks) => {
  try {
    console.log(`Pausing tracks for session ${sessionId}:`, tracks);

    if (captureClient) {
      await captureClient.pauseTracks(tracks);
    } else {
      throw new Error('No active capture client');
    }

    return { success: true };
  } catch (error) {
    console.error('Error pausing tracks:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recorder-resume-tracks', async (event, sessionId, tracks) => {
  try {
    console.log(`Resuming tracks for session ${sessionId}:`, tracks);

    if (captureClient) {
      await captureClient.resumeTracks(tracks);
    } else {
      throw new Error('No active capture client');
    }

    return { success: true };
  } catch (error) {
    console.error('Error resuming tracks:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recorder-request-permission', async (event, type) => {
  try {
    console.log(`Requesting permission: ${type}`);

    const permissionMap = {
      'microphone': 'microphone',
      'screen': 'screen-capture',
      'screen-capture': 'screen-capture'
    };

    const sdkPermission = permissionMap[type] || type;

    if (!captureClient) {
      const sessionToken = await getSessionToken();
      if (sessionToken) {
        const tempOptions = { sessionToken };
        if (process.env.VIDEODB_API_URL) {
          tempOptions.apiUrl = process.env.VIDEODB_API_URL;
        }
        const tempClient = new CaptureClient(tempOptions);
        const result = await tempClient.requestPermission(sdkPermission);
        await tempClient.shutdown();
        return { success: true, status: result };
      }
      return { success: true, status: 'undetermined' };
    }

    const result = await captureClient.requestPermission(sdkPermission);
    return { success: true, status: result };
  } catch (error) {
    console.error('Error requesting permission:', error);
    return { success: false, error: error.message };
  }
});

// Permission handlers (macOS systemPreferences)
ipcMain.handle('check-mic-permission', () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'granted';
});

ipcMain.handle('check-screen-permission', () => {
  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status || 'unknown';
    } catch (error) {
      console.error('Screen permission check error:', error);
      return 'error';
    }
  }
  return 'granted';
});

ipcMain.handle('request-mic-permission', async () => {
  if (process.platform === 'darwin') {
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { granted, status: granted ? 'granted' : 'denied' };
    } catch (error) {
      console.error('Mic permission error:', error);
      return { granted: false, status: 'error', message: error.message };
    }
  }
  return { granted: true, status: 'granted' };
});

ipcMain.handle('check-camera-permission', () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('camera');
  }
  return 'granted';
});

ipcMain.handle('request-camera-permission', async () => {
  if (process.platform === 'darwin') {
    try {
      const granted = await systemPreferences.askForMediaAccess('camera');
      return { granted, status: granted ? 'granted' : 'denied' };
    } catch (error) {
      console.error('Camera permission error:', error);
      return { granted: false, status: 'error', message: error.message };
    }
  }
  return { granted: true, status: 'granted' };
});

ipcMain.handle('open-system-settings', async (event, type) => {
  try {
    let url = '';

    if (process.platform === 'darwin') {
      if (type === 'mic') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
      } else if (type === 'screen') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
      } else if (type === 'camera') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
      }
    } else if (process.platform === 'win32') {
      if (type === 'mic') {
        url = 'ms-settings:privacy-microphone';
      } else if (type === 'camera') {
        url = 'ms-settings:privacy-webcam';
      } else if (type === 'screen') {
        url = 'ms-settings:privacy';
      }
    }

    if (url) {
      console.log(`Open System Settings: ${url}`);
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Unknown type or unsupported platform' };
  } catch (error) {
    console.error('Failed to open system settings:', error);
    return { success: false, error: error.message };
  }
});

// Config Handlers
ipcMain.handle('get-settings', () => {
  return {
    ...appConfig,
    backendBaseUrl: `http://localhost:${serverPort}`,
    callbackUrl: webhookUrl,
    isConnected: !!appConfig.accessToken
  };
});

// Registration Handler (direct SDK call, no HTTP)
ipcMain.handle('register', async (event, data) => {
  try {
    const { name, apiKey } = data;
    console.log(`Registering user: ${name}`);

    // 1. Verify API key with VideoDB SDK
    const valid = await videodbService.verifyApiKey(apiKey);
    if (!valid) {
      return { success: false, error: 'Invalid API key. Please check your key and try again.' };
    }

    // 2. Create or update user in local DB
    const existingUser = findUserByApiKey(apiKey);
    let accessToken;
    let userName = name || 'Guest';

    if (existingUser) {
      accessToken = existingUser.access_token;
      userName = existingUser.name;
    } else {
      accessToken = randomUUID();
      createUser(userName, apiKey, accessToken);
    }

    console.log('Registration successful. Token generated.');

    // 3. Save user auth config
    saveUserConfig({ accessToken, userName });

    // 4. Clear any stale session token cache
    cachedSessionToken = null;
    tokenExpiresAt = null;

    return { success: true, userName };

  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('recorder-logout', async () => {
  console.log('Logging out...');
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      console.log('Config file deleted');
    }

    // Reset memory state
    appConfig = {
      accessToken: null,
      userName: null
    };
    cachedSessionToken = null;
    tokenExpiresAt = null;

    // Clear VideoDB connection cache
    if (videodbService) {
      videodbService.clearAll();
    }

    // Cleanup capture client if exists
    if (captureClient) {
      try {
        await captureClient.shutdown();
      } catch (e) {
        // Ignore shutdown errors on logout
      }
      captureClient = null;
    }

    return { success: true };
  } catch (error) {
    console.error('Logout failed:', error);
    return { success: false, error: error.message };
  }
});

// Camera Window Handler
let cameraLoaded = false;

function createCameraWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const bubbleSize = 250;
  const margin = 20;

  cameraWindow = new BrowserWindow({
    width: bubbleSize,
    height: bubbleSize,
    x: screenWidth - bubbleSize - margin,
    y: screenHeight - bubbleSize - margin,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  cameraWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

ipcMain.handle('camera-show', async () => {
  if (cameraWindow && !cameraWindow.isDestroyed()) {
    if (process.platform === 'darwin') {
      const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
      console.log('[Camera] Current permission status:', cameraStatus);

      if (cameraStatus !== 'granted') {
        console.log('[Camera] Requesting camera permission...');
        const granted = await systemPreferences.askForMediaAccess('camera');
        console.log('[Camera] Permission granted:', granted);
        if (!granted) {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
          return { success: false, error: 'Camera permission denied' };
        }
      }
    }

    if (!cameraLoaded) {
      cameraWindow.loadFile(path.join(__dirname, 'camera.html'));
      cameraLoaded = true;
    }
    cameraWindow.showInactive();
    return { success: true };
  }
  return { success: false, error: 'Camera window not found' };
});

ipcMain.handle('camera-hide', () => {
  if (cameraWindow && !cameraWindow.isDestroyed()) {
    cameraWindow.hide();
    return { success: true };
  }
  return { success: false, error: 'Camera window not found' };
});

// --- History Window ---
let historyWindow = null;

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Recording History',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  historyWindow.loadFile(path.join(__dirname, 'history.html'));

  historyWindow.on('closed', () => {
    historyWindow = null;
  });
}

ipcMain.handle('open-history-window', () => {
  createHistoryWindow();
  return { success: true };
});

// History Handler (direct DB query, no HTTP)
ipcMain.handle('get-recordings', async () => {
  try {
    const recordings = dbGetRecordings(20);
    return recordings.map(r => ({
      id: r.id,
      session_id: r.session_id,
      stream_url: r.stream_url,
      player_url: r.player_url,
      created_at: r.created_at,
      duration: r.duration,
      insights_status: r.insights_status,
      insights: r.insights,
    }));
  } catch (error) {
    console.error('Failed to get recordings:', error);
    return [];
  }
});


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 468,
    height: 720,
    minHeight: 720,
    maxHeight: 960,
    minWidth: 444,
    maxWidth: 600,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  await initializeApp();
  createWindow();
  createCameraWindow();
});

// Centralized shutdown handler
let isShuttingDown = false;

async function shutdownApp() {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  console.log('Shutting down application...');

  try {
    if (captureClient) {
      await captureClient.shutdown();
      captureClient = null;
      console.log('CaptureClient shutdown complete');
    }
  } catch (error) {
    console.error('Error during SDK shutdown:', error);
  }

  // Stop tunnel
  if (tunnelManager) {
    tunnelManager.stop();
    console.log('Tunnel stopped');
  }

  // Stop Express server
  if (expressServer) {
    expressServer.close();
    console.log('Express server stopped');
  }

  // Close database
  closeDatabase();
  console.log('Database closed');
}

// Handle window close
app.on('window-all-closed', async () => {
  await shutdownApp();
  if (process.platform !== 'darwin') app.quit();
});

// Handle app quit (Cmd+Q, etc.)
app.on('before-quit', async (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    await shutdownApp();
    app.exit(0);
  }
});

// Handle terminal signals (Ctrl+C, kill, etc.)
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT (Ctrl+C)');
  await shutdownApp();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM');
  await shutdownApp();
  process.exit(0);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
