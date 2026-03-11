const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { CaptureClient } = require('videodb/capture');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// --- In-process server modules ---
const { initDatabase, closeDatabase, findUserByToken, findUserByApiKey, createUser, getRecordings: dbGetRecordings, getRecordingById, createRecording, findRecordingBySessionId, updateRecording, getOrphanedRecordings } = require('./server/database');
const { VideoDBService } = require('./server/videodb-service');
const { indexVideo } = require('./server/insights-service');

let mainWindow;
let cameraWindow;

// CaptureClient instance (created per session)
let captureClient = null;

// WebSocket connection for real-time events
let wsConnection = null;
let wsCloseTimeout = null;

// In-process services
let videodbService = null;

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
    await initDatabase(DB_FILE);

    // 2. Create VideoDB service
    const apiUrl = process.env.VIDEODB_API_URL || null;
    videodbService = new VideoDBService({ baseUrl: apiUrl });

    // 3. Load user config
    loadUserConfig();

    // 4. Auto-register if setup was run
    await autoRegisterFromSetup();

    // 5. Sync any orphaned recordings from previous sessions
    syncOrphanedSessions();

    console.log('VideoDB SDK Configuration:');
    console.log('- AUTH_STATUS:', appConfig.accessToken ? 'Connected' : 'Needs Connection');
    console.log('- EVENT_DELIVERY: WebSocket');
    console.log('App ready (CaptureClient will be created per session)');
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

/**
 * Background indexing task — runs async, updates DB with results.
 */
async function processIndexingBackground(recordingId, videoId, apiKey) {
  try {
    updateRecording(recordingId, { insights_status: 'processing' });
    console.log(`[Index] Starting indexing for recording ${recordingId}`);

    const result = await indexVideo(videoId, apiKey);

    if (result) {
      const updates = { insights_status: 'ready' };
      if (result.transcript) {
        updates.insights = JSON.stringify({ transcript: result.transcript });
      }
      if (result.subtitleUrl) {
        updates.stream_url = result.subtitleUrl;
        const recording = getRecordingById(recordingId);
        if (recording && recording.player_url && recording.player_url.includes('url=')) {
          updates.player_url = recording.player_url.replace(/url=[^&]+/, `url=${result.subtitleUrl}`);
        } else {
          updates.player_url = result.subtitleUrl;
        }
      }
      updateRecording(recordingId, updates);
      console.log(`[Index] Indexed video ${videoId} successfully`);
    } else {
      updateRecording(recordingId, { insights_status: 'failed' });
      console.warn(`[Index] Failed to index video ${videoId}`);
    }
  } catch (err) {
    console.error(`[Index] Error processing:`, err);
    try {
      updateRecording(recordingId, { insights_status: 'failed' });
    } catch (e) {
      // Ignore DB errors during error handling
    }
  }
}

/**
 * Poll a capture session's status and sync to local DB if exported.
 * Used as fallback when WebSocket misses the exported event.
 */
async function syncCaptureSession(sessionId, apiKey) {
  const POLL_INTERVAL = 10_000;
  while (true) {
    try {
      const session = await videodbService.getCaptureSession(apiKey, sessionId);

      if (session.exportedVideoId) {
        console.log(`[Sync] Exported video received: ${session.exportedVideoId}`);
        const recording = findRecordingBySessionId(sessionId);
        if (recording) {
          updateRecording(recording.id, {
            video_id: session.exportedVideoId,
            stream_url: session.streamUrl,
            player_url: session.playerUrl,
            insights_status: 'pending',
          });
          processIndexingBackground(recording.id, session.exportedVideoId, apiKey);
        }
        return;
      }

      if (session.status === 'failed') {
        console.log(`[Sync] Session failed: ${sessionId}`);
        const recording = findRecordingBySessionId(sessionId);
        if (recording) updateRecording(recording.id, { insights_status: 'failed' });
        return;
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    } catch (err) {
      console.error(`[Sync] Error:`, err.message);
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }
}

/**
 * On app startup, check for recordings that started but never got an export event.
 */
async function syncOrphanedSessions() {
  const apiKey = getCurrentUserApiKey();
  if (!apiKey) return;

  const orphaned = getOrphanedRecordings();
  if (orphaned.length === 0) return;

  console.log(`[Sync] Found ${orphaned.length} orphaned recording(s), syncing...`);
  for (const rec of orphaned) {
    await syncCaptureSession(rec.session_id, apiKey, 1);
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
      console.error('User not found in DB for token:', appConfig.accessToken?.substring(0, 8) + '...');
      return { success: false, error: 'User not found. Please register first.' };
    }

    // 1a. Connect WebSocket for real-time events
    console.log('[WS] Connecting WebSocket...');
    try {
      wsConnection = await videodbService.connectWebsocket(user.api_key);
      console.log(`[WS] WebSocket connected, connectionId: ${wsConnection.connectionId}`);
    } catch (err) {
      console.error('[WS] WebSocket connection failed:', err.message);
      wsConnection = null;
      return { success: false, error: 'WebSocket connection failed: ' + err.message };
    }

    // 1b. Create capture session directly via VideoDB SDK
    console.log('Creating capture session via SDK...');
    let captureSessionId;
    try {
      const sessionData = await videodbService.createCaptureSession(user.api_key, {
        endUserId: `user-${user.id}`,
        wsConnectionId: wsConnection.connectionId,
        metadata: { clientSessionId, startedAt: Date.now() },
      });
      captureSessionId = sessionData.sessionId;
      console.log(`Capture session created: ${captureSessionId}`);
    } catch (err) {
      console.error('Error creating capture session:', err);
      return { success: false, error: 'Failed to create capture session: ' + err.message };
    }

    // 1c. Save session_id to DB immediately with local timestamp (so we can recover if WS drops)
    createRecording({ session_id: captureSessionId, created_at: new Date().toISOString(), insights_status: 'recording' });

    // 1d. Start background WebSocket event listener
    const ws = wsConnection;
    const wsSessionId = captureSessionId;
    const wsApiKey = user.api_key;
    (async () => {
      let receivedTerminalEvent = false;
      try {
        console.log('[WS] Listening for capture session events...');
        for await (const msg of ws.receive()) {
          const channel = msg.channel || msg.type || 'unknown';
          const status = msg.data?.status || msg.status || '';
          console.log(`[WS] ${channel}: ${status}`);

          // Handle video data — may arrive with 'exported' or 'stopped' status
          if (channel === 'capture_session') {
            const data = msg.data || {};
            const videoId = data.exported_video_id;
            const streamUrl = data.stream_url;
            const playerUrl = data.player_url;
            const sessionId = msg.capture_session_id;

            if (videoId) {
              const recording = findRecordingBySessionId(sessionId);
              if (recording) {
                updateRecording(recording.id, {
                  video_id: videoId,
                  stream_url: streamUrl,
                  player_url: playerUrl,
                  insights_status: 'pending',
                });
                console.log(`[WS] Updated recording: ${videoId}`);
                processIndexingBackground(recording.id, videoId, wsApiKey);
              }
            }
          }

          // Auto-close after terminal events (stopped = complete, exported = legacy, failed = error)
          if (channel === 'capture_session' && (status === 'stopped' || status === 'exported' || status === 'failed')) {
            receivedTerminalEvent = true;
            if (wsCloseTimeout) { clearTimeout(wsCloseTimeout); wsCloseTimeout = null; }
            console.log(`[WS] Terminal event (${status}), closing WebSocket...`);
            await ws.close();
            if (wsConnection === ws) wsConnection = null;
            break;
          }
        }
      } catch (err) {
        console.error('[WS] Listener error:', err.message);
      }

      // Sync recording if video data is still missing
      try {
        const rec = findRecordingBySessionId(wsSessionId);
        if (!receivedTerminalEvent || (rec && !rec.video_id)) {
          await syncCaptureSession(wsSessionId, wsApiKey);
        }
      } catch (fallbackErr) {
        console.error('[Sync] Error:', fallbackErr.message);
      }
    })();

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

// Open External Link
ipcMain.handle('open-external-link', async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('recorder-stop-recording', async (event, sessionId) => {
  console.log(`Stopping recording for session: ${sessionId}`);

  if (!captureClient) {
    console.warn('No active capture client to stop');
    return { success: true };
  }

  // Stop + shutdown are best-effort — the binary may already be gone.
  // WebSocket stays open regardless, so exported events still arrive.
  try {
    await captureClient.stopSession();
    console.log('Capture session stopped');
  } catch (stopErr) {
    console.warn('CaptureClient stop warning:', stopErr.message);
  }

  try {
    await captureClient.shutdown();
    console.log('CaptureClient shutdown complete');
  } catch (shutdownErr) {
    console.warn('CaptureClient shutdown warning:', shutdownErr.message);
  }
  captureClient = null;

  // Start timeout: if WS doesn't receive exported/failed within 2 min, force-close
  // so the listener falls through to polling fallback.
  if (wsConnection && !wsCloseTimeout) {
    const ws = wsConnection;
    wsCloseTimeout = setTimeout(async () => {
      console.log('[WS] Timeout waiting for terminal event, closing...');
      try { await ws.close(); } catch (e) { /* ignore */ }
      if (wsConnection === ws) wsConnection = null;
      wsCloseTimeout = null;
    }, 120_000);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recorder-event', {
      event: 'recording:stopped',
      data: { sessionId }
    });
  }

  return { success: true };
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
      name: r.name,
      video_id: r.video_id,
      session_id: r.session_id,
      stream_url: r.stream_url,
      player_url: r.player_url,
      created_at: r.created_at,
      insights_status: r.insights_status,
      insights: r.insights,
    }));
  } catch (error) {
    console.error('Failed to get recordings:', error);
    return [];
  }
});


ipcMain.handle('get-share-url', async (event, videoId) => {
  try {
    const apiKey = getCurrentUserApiKey();
    if (!apiKey) return { success: false, error: 'Not authenticated' };
    const urls = await videodbService.getShareUrl(apiKey, videoId);
    return { success: true, ...urls };
  } catch (error) {
    console.error('Error getting share URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-recording-name', async (event, id, name) => {
  try {
    updateRecording(id, { name });
    return { success: true };
  } catch (error) {
    console.error('Error updating recording name:', error);
    return { success: false, error: error.message };
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

  // Clear any pending WS timeout
  if (wsCloseTimeout) { clearTimeout(wsCloseTimeout); wsCloseTimeout = null; }

  // Close WebSocket
  if (wsConnection) {
    try {
      await wsConnection.close();
      console.log('[WS] WebSocket closed');
    } catch (e) {
      // ignore
    }
    wsConnection = null;
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
