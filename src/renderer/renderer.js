/**
 * Main Renderer Process
 */
import { addLog } from './utils/logger.js';
import { initBar, setSessionActive, setSessionLoading, resetSessionUI, getActiveSessionId, loadDevices, getSelectedChannels } from './ui/bar.js';

// Permissions and onboarding are now separate modal windows
// import { initOnboarding } from './ui/onboarding.js';
// import { initPermissionsFlow } from './ui/permissions.js';
// import { initHistoryLogic } from './src/ui/history.js'; // Moved to history.html

// Global Event Handler
// Prevent duplicate registration on reload
if (!window.hasRegisteredRecorderEvents) {
  window.hasRegisteredRecorderEvents = true;

  window.recorderAPI.onRecorderEvent((eventData) => {
    const { event, data } = eventData;
    console.log('[Recorder Event]', event, data);

    switch (event) {

      case 'recording:started':
        addLog(`Recording started: ${data.sessionId}`, 'success');
        setSessionActive(data.sessionId);
        window.recorderAPI.notifyRecordingState(true);
        window.recorderAPI.showNotification('Recording Started', 'Screen and audio capture is active.');
        break;
      case 'recording:stopped':
        addLog(`Recording stopped: ${data.sessionId}`, 'info');
        resetSessionUI();
        window.recorderAPI.notifyRecordingState(false);
        window.recorderAPI.showNotification('Recording Stopped', 'Your recording is being processed.');
        break;
      case 'recording:error':
        addLog(`Recording error: ${data.error || data.message || 'Unknown error'}`, 'error');
        resetSessionUI();
        window.recorderAPI.notifyRecordingState(false);
        break;
      case 'upload:progress':
        console.log(`Upload progress: ${data.channelId} - ${Math.round((data.progress || 0) * 100)}%`);
        break;
      case 'upload:complete':
        addLog(`Upload complete`, 'success');
        window.recorderAPI.showNotification('Upload Complete', 'Your recording is ready to view.');
        break;
      case 'shortcut:toggle-recording': {
        const sessionId = getActiveSessionId();
        if (sessionId) {
          window.recorderAPI.stopSession(sessionId).then(() => resetSessionUI());
        } else {
          startSessionFlow();
        }
        break;
      }
      case 'modal:complete':
        console.log('[Modal Complete]', data);
        if (data.type === 'onboarding') {
          loadDevices();
        }
        // Re-enable start button after modals complete
        const btnStart = document.getElementById('btn-start-session');
        if (btnStart) btnStart.disabled = false;
        break;
      case 'error':
        addLog(`Error: ${data.message || 'Unknown error'}`, 'error');
        break;
      default:
        break;
    }
  });
}

async function startSessionFlow() {
  // Generate Session ID
  const sessionId = 'session-' + Date.now();

  addLog('Starting recording...', 'info');
  setSessionLoading();

  try {
    const channels = getSelectedChannels();
    const result = await window.recorderAPI.startSession(sessionId, channels);

    if (!result.success) {
      addLog(`Failed to start: ${result.error}`, 'error');
      resetSessionUI();
    }
  } catch (error) {
    addLog(`Start error: ${error.message}`, 'error');
    resetSessionUI();
  }
}

// Initialization
(async () => {
  try {
    addLog('🚀 App initializing...');

    // Init floating bar (wires up button handlers)
    console.log('Initializing bar...');
    await initBar(startSessionFlow);

    // Check permissions — open modal window if not granted
    const micOk = (await window.recorderAPI.checkMicPermission()) === 'granted';
    const screenOk = (await window.recorderAPI.checkScreenPermission()) === 'granted';

    if (!micOk || !screenOk) {
      console.log('Permissions missing, opening modal...');
      const btnStart = document.getElementById('btn-start-session');
      if (btnStart) btnStart.disabled = true;
      await window.recorderAPI.showPermissionsModal();
    }

    // Check onboarding — open modal window if no API key
    const config = await window.configAPI.getConfig();
    if (!config.accessToken) {
      console.log('No API key, opening onboarding modal...');
      const btnStart = document.getElementById('btn-start-session');
      if (btnStart) btnStart.disabled = true;
      await window.recorderAPI.showOnboardingModal();
    }

    // Load available devices (requires auth)
    const configCheck = await window.configAPI.getConfig();
    if (configCheck.accessToken) {
      console.log('Loading available devices...');
      await loadDevices();
    }

    addLog('Ready');
    console.log('Initialization complete.');
  } catch (error) {
    console.error('Initialization failed:', error);
    addLog(`❌ Init Error: ${error.message}`, 'error');
  }
})();
