const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { CaptureClient } = require('videodb/capture');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });



let mainWindow;
let cameraWindow;

// CaptureClient instance (created per session)
let captureClient = null;

// Configuration

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const RUNTIME_FILE = path.join(__dirname, '..', 'runtime.json');
const AUTH_CONFIG_FILE = path.join(__dirname, '..', 'auth_config.json');

let appConfig = {
  accessToken: null,
  userName: null
};

let runtimeConfig = {
  backendBaseUrl: null,
  callbackUrl: null
};

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

// 2. Load Runtime Config (Ephemeral Server Info)
function loadRuntimeConfig() {
  try {
    if (fs.existsSync(RUNTIME_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));

      // Update runtime state
      if (data.api_url) runtimeConfig.backendBaseUrl = data.api_url;
      if (data.webhook_url) runtimeConfig.callbackUrl = data.webhook_url;

      console.log('Loaded Runtime Config:', RUNTIME_FILE);
      console.log('   - Backend:', runtimeConfig.backendBaseUrl);
      console.log('   - Callback:', runtimeConfig.callbackUrl);
      console.log('   - Updated:', new Date(data.updated_at).toLocaleTimeString());
    } else {
      console.warn('Runtime config not found at:', RUNTIME_FILE);
      console.warn('   Ensure the Python server is running.');
    }
  } catch (error) {
    console.error('Error loading runtime config:', error);
  }
}

// Session token cache (valid for 24 hours)
let cachedSessionToken = null;
let tokenExpiresAt = null;

// 3. Auto-register from auth_config.json (created by npm run setup)
async function autoRegisterFromSetup() {
  // Check if auth_config.json exists (from npm run setup)
  if (!fs.existsSync(AUTH_CONFIG_FILE)) {
    // No setup file - use existing config or show onboarding
    return;
  }

  // auth_config.json exists - always register with these credentials
  // This allows users to re-run setup to update their API key
  try {
    const authConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    const { apiKey, name } = authConfig;

    if (!apiKey) {
      console.log('No API key in auth_config.json');
      fs.unlinkSync(AUTH_CONFIG_FILE);
      return;
    }

    console.log(`Registering from setup: ${name || 'Guest'}`);

    // Wait for runtime config to be available
    if (!runtimeConfig.backendBaseUrl) {
      console.log('Backend not ready, will register on next launch');
      return;
    }

    const baseUrl = runtimeConfig.backendBaseUrl;
    const registerUrl = `${baseUrl}/api/register`;

    const response = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'Guest', api_key: apiKey })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Registration failed:', errorText);
      // Delete auth_config.json and clear old token so onboarding shows
      fs.unlinkSync(AUTH_CONFIG_FILE);
      appConfig.accessToken = null;
      saveUserConfig({ accessToken: null, userName: null });
      console.log('Invalid credentials - please re-enter in onboarding');
      return;
    }

    const result = await response.json();
    console.log('Registration successful!');

    // Save user config
    const newConfig = {
      accessToken: result.access_token,
      userName: result.name
    };
    saveUserConfig(newConfig);

    // Delete auth_config.json after successful registration
    fs.unlinkSync(AUTH_CONFIG_FILE);
    console.log('Setup complete - auth_config.json removed');

  } catch (error) {
    console.error('Registration error:', error);
    // Clean up on error
    if (fs.existsSync(AUTH_CONFIG_FILE)) {
      fs.unlinkSync(AUTH_CONFIG_FILE);
    }
  }
}

// Initialize SDK on app ready
async function initializeSDK() {
  try {
    // Load configs
    loadUserConfig();
    loadRuntimeConfig();

    // Auto-register if setup was run but not yet registered
    await autoRegisterFromSetup();

    console.log('VideoDB SDK Configuration:');
    console.log('- AUTH_STATUS:', appConfig.accessToken ? 'Connected' : 'Needs Connection');
    console.log('- BACKEND_BASE_URL:', runtimeConfig.backendBaseUrl);

    // CaptureClient is now created per-session when starting recording
    // No global init needed
    console.log('SDK ready (CaptureClient will be created per session)');
  } catch (error) {
    console.error('Failed to initialize SDK:', error);
  }
}

// Setup event listeners on the CaptureClient instance
function setupCaptureClientEvents(client) {
  // Map new SDK events to existing event names for backwards compatibility with renderer
  client.on('recording:started', (data) => {
    console.log('SDK Event: recording:started', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:started',
        data
      });
    }
  });

  client.on('recording:stopped', (data) => {
    console.log('SDK Event: recording:stopped', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:stopped',
        data
      });
    }
  });

  client.on('recording:error', (data) => {
    console.log('SDK Event: recording:error', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'recording:error',
        data
      });
    }
  });

  client.on('upload:progress', (data) => {
    console.log('SDK Event: upload:progress', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'upload:progress',
        data
      });
    }
  });

  client.on('upload:complete', (data) => {
    console.log('SDK Event: upload:complete', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'upload:complete',
        data
      });
    }
  });

  client.on('error', (data) => {
    console.log('SDK Event: error', data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder-event', {
        event: 'error',
        data
      });
    }
  });
}

// IPC Handlers for Capture SDK
// Helper function to get or fetch session token
async function getSessionToken() {
  // Check if we have a valid cached token
  if (cachedSessionToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    console.log('Using cached session token (expires in', Math.round((tokenExpiresAt - Date.now()) / 1000 / 60), 'minutes)');
    return cachedSessionToken;
  }

  // Need to fetch a new token
  // Use dynamic URL from runtime config
  const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
  const tokenEndpoint = `${baseUrl}/api/token`;
  const accessToken = appConfig.accessToken;

  if (!accessToken) {
    console.warn('Access Token not available. Please register first.');
    return null;
  }

  try {
    console.log(`fetching session token from: ${tokenEndpoint}`);
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'x-access-token': accessToken, // Send UUID token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: "electron-user" // Optional, backend will use internal ID if mapped
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Error fetching token: ${response.status} ${errText}`);
      throw new Error(`Failed to fetch token: ${response.status}`);
    }

    const data = await response.json();
    if (data.session_token) {
      cachedSessionToken = data.session_token;
      // expires_in is in seconds, convert to ms and subtract a buffer (e.g. 5 mins)
      const expiresInMs = (data.expires_in || 3600) * 1000;
      tokenExpiresAt = Date.now() + expiresInMs - (5 * 60 * 1000);
      return cachedSessionToken;
    }
  } catch (error) {
    console.error('Network error fetching token:', error);
  }
  return null;
}

ipcMain.handle('recorder-start-recording', async (event, clientSessionId, config) => {
  try {
    console.log(`Starting recording (client reference: ${clientSessionId})`);

    // CONFIGURATION
    const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
    const accessToken = appConfig.accessToken;

    if (!accessToken) {
      console.error('Not authenticated');
      return { success: false, error: 'Not authenticated. Please register first.' };
    }

    // 1. Create capture session on the server FIRST (required by new SDK)
    console.log('Creating capture session on server...');
    let captureSessionId;
    try {
      const createSessionResp = await fetch(`${baseUrl}/api/capture-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken
        },
        body: JSON.stringify({
          callback_url: runtimeConfig.callbackUrl,
          metadata: { clientSessionId, startedAt: Date.now() }
        })
      });

      if (!createSessionResp.ok) {
        const errText = await createSessionResp.text();
        console.error(`Failed to create capture session: ${createSessionResp.status} ${errText}`);
        return { success: false, error: 'Failed to create capture session on server' };
      }

      const sessionData = await createSessionResp.json();
      captureSessionId = sessionData.session_id;
      console.log(`Capture session created: ${captureSessionId}`);
    } catch (err) {
      console.error('Error creating capture session:', err);
      return { success: false, error: 'Failed to create capture session: ' + err.message };
    }

    // 3. Get session token (from cache or fetch new one)
    const sessionToken = await getSessionToken();
    if (!sessionToken) {
      console.error('Failed to get session token');
      return { success: false, error: 'Failed to get session token. Please register first.' };
    }

    // 4. Create a new CaptureClient instance
    const captureOptions = { sessionToken: sessionToken };
    if (process.env.VIDEODB_API_URL) {
      captureOptions.apiUrl = process.env.VIDEODB_API_URL;
    }
    console.log(`Creating CaptureClient`, captureOptions);

    captureClient = new CaptureClient(captureOptions);

    // Setup event listeners
    setupCaptureClientEvents(captureClient);

    // 5. List available channels
    console.log('Listing available channels...');
    let channels;
    try {
      channels = await captureClient.listChannels();
      // Log all available channels
      for (const ch of channels.all()) {
        console.log(`  - ${ch.id} (${ch.type}): ${ch.name}`);
      }
    } catch (err) {
      console.error('Failed to list channels:', err);
      return { success: false, error: 'Failed to list capture channels' };
    }

    // 6. Select channels for capture (using new SDK API)
    const captureChannels = [];

    // Get default mic channel
    const micChannel = channels.mics.default;
    if (micChannel) {
      captureChannels.push({
        channelId: micChannel.id,
        type: 'audio',
        store: true
      });
      console.log(`Selected mic channel: ${micChannel.id}`);
    }

    // Get default system audio channel
    const systemAudioChannel = channels.systemAudio.default;
    if (systemAudioChannel) {
      captureChannels.push({
        channelId: systemAudioChannel.id,
        type: 'audio',
        store: true
      });
      console.log(`Selected system audio channel: ${systemAudioChannel.id}`);
    }

    // Get default display channel
    const displayChannel = channels.displays.default;
    if (displayChannel) {
      captureChannels.push({
        channelId: displayChannel.id,
        type: 'video',
        store: true,
      });
      console.log(`Selected display channel: ${displayChannel.id}`);
    }

    if (captureChannels.length === 0) {
      console.error('No capture channels available');
      return { success: false, error: 'No capture channels available. Check permissions.' };
    }

    // 7. Start capture session with the SERVER-CREATED session ID
    console.log('Starting capture session with options:', JSON.stringify({
      sessionId: captureSessionId,
      channels: captureChannels
    }, null, 2));

    await captureClient.startSession({
      sessionId: captureSessionId,
      channels: captureChannels,
    });

    console.log('Capture session started successfully');

    // Manually emit recording:started event to update UI
    // (The SDK may not emit this event consistently)
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

// Check Tunnel Status Handler
ipcMain.handle('check-tunnel-status', async () => {
  try {
    const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
    const response = await fetch(`${baseUrl}/api/tunnel/status`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to check tunnel status:', error);
    return { active: false, error: error.message };
  }
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

      // Shutdown the capture client to release the binary
      try {
        await captureClient.shutdown();
        console.log('CaptureClient shutdown complete');
      } catch (shutdownErr) {
        console.warn('CaptureClient shutdown warning:', shutdownErr.message);
      }
      captureClient = null;

      // Manually emit recording:stopped event to update UI
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

    // Map permission types to SDK expected values
    const permissionMap = {
      'microphone': 'microphone',
      'screen': 'screen-capture',
      'screen-capture': 'screen-capture'
    };

    const sdkPermission = permissionMap[type] || type;

    // Create a temporary client for permission requests if needed
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
      // Fall back to system preferences for permission check
      return { success: true, status: 'undetermined' };
    }

    const result = await captureClient.requestPermission(sdkPermission);
    return { success: true, status: result };
  } catch (error) {
    console.error('Error requesting permission:', error);
    return { success: false, error: error.message };
  }
});

// Keep existing permission handlers for Electron APIs
// Note: systemPreferences permission APIs are macOS-only
// On Windows, permissions are handled at the browser level via getUserMedia

ipcMain.handle('check-mic-permission', () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'granted'; // Windows handles this via browser prompt
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
  return 'granted'; // Windows handles this via browser prompt
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
  // Windows: permission handled by browser when getUserMedia is called
  return { granted: true, status: 'granted' };
});

// Camera permission handlers
ipcMain.handle('check-camera-permission', () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('camera');
  }
  return 'granted'; // Windows handles this via browser prompt
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
  // Windows: permission handled by browser when getUserMedia is called
  return { granted: true, status: 'granted' };
});

ipcMain.handle('open-system-settings', async (event, type) => {
  try {
    let url = '';

    if (process.platform === 'darwin') {
      // macOS system preferences URLs
      if (type === 'mic') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
      } else if (type === 'screen') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
      } else if (type === 'camera') {
        url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
      }
    } else if (process.platform === 'win32') {
      // Windows Settings app URLs
      if (type === 'mic') {
        url = 'ms-settings:privacy-microphone';
      } else if (type === 'camera') {
        url = 'ms-settings:privacy-webcam';
      } else if (type === 'screen') {
        // Windows doesn't have a dedicated screen capture privacy setting
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
  // Return combined config
  return {
    ...appConfig,
    ...runtimeConfig, // Runtime / Local overrides take precedence for display
    isConnected: !!appConfig.accessToken
  };
});

// Registration Handler
ipcMain.handle('register', async (event, data) => {
  try {
    const { name, apiKey } = data;

    // 1. Call Python Backend to Register
    // Use runtime config to find the server
    const baseUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8000';
    const registerUrl = `${baseUrl}/api/register`;

    console.log(`Registering user: ${name} at ${registerUrl}`);

    const response = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, api_key: apiKey })
    });

    if (!response.ok) {
      const errJson = await response.json();
      return { success: false, error: errJson.detail || 'Registration failed' };
    }

    const result = await response.json();
    const accessToken = result.access_token;
    console.log('Registration successful. Token received.');

    // 2. Save User Auth
    const newConfig = {
      accessToken: accessToken,
      userName: result.name
    };

    saveUserConfig(newConfig);

    // 3. Re-initialize SDK config
    await initializeSDK();

    return { success: true, userName: result.name };

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
      backendBaseUrl: null,
      callbackUrl: null,
      userName: null
    };
    cachedSessionToken = null;
    tokenExpiresAt = null;

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

  const bubbleSize = 250; // 10% smaller than 280
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
    show: false, // Hidden by default
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Don't load camera.html yet - defer until first show
  cameraWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// IPC Handlers for Camera
ipcMain.handle('camera-show', async () => {
  if (cameraWindow && !cameraWindow.isDestroyed()) {
    // Request camera permission before showing (macOS only)
    if (process.platform === 'darwin') {
      const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
      console.log('[Camera] Current permission status:', cameraStatus);

      if (cameraStatus !== 'granted') {
        console.log('[Camera] Requesting camera permission...');
        const granted = await systemPreferences.askForMediaAccess('camera');
        console.log('[Camera] Permission granted:', granted);
        if (!granted) {
          // Open system settings if permission denied
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
          return { success: false, error: 'Camera permission denied' };
        }
      }
    }
    // On Windows, camera permission is handled by the browser when getUserMedia is called

    // Lazy load camera.html on first show
    if (!cameraLoaded) {
      cameraWindow.loadFile(path.join(__dirname, 'camera.html'));
      cameraLoaded = true;
      // Debug: Open DevTools for camera window (remove in production)
      // cameraWindow.webContents.openDevTools({ mode: 'detach' });
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
      preload: path.join(__dirname, 'preload.js'), // Reuse preload for recorderAPI access
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

// History Handler
ipcMain.handle('get-recordings', async () => {
  try {
    const backendUrl = runtimeConfig.backendBaseUrl || 'http://localhost:8002';
    // We need to fetch from the local python server.
    // Using global fetch (Electron 18+)
    const response = await fetch(`${backendUrl}/api/recordings`, {
      headers: {
        'x-access-token': appConfig.accessToken
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch recordings: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
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

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  await initializeSDK();
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
