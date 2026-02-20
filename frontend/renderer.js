/**
 * Main Renderer Process
 */
import { addLog } from './src/utils/logger.js';
import { initSidebar, setSessionActive, setSessionLoading, resetSessionUI } from './src/ui/sidebar.js';

import { initOnboarding } from './src/ui/onboarding.js';
import { initPermissionsFlow } from './src/ui/permissions.js';
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
        break;
      case 'recording:stopped':
        addLog(`Recording stopped: ${data.sessionId}`, 'info');
        resetSessionUI();
        break;
      case 'recording:error':
        addLog(`Recording error: ${data.error || data.message || 'Unknown error'}`, 'error');
        resetSessionUI();
        break;
      case 'upload:progress':
        console.log(`Upload progress: ${data.channelId} - ${Math.round((data.progress || 0) * 100)}%`);
        break;
      case 'upload:complete':
        addLog(`Upload complete`, 'success');
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
    const result = await window.recorderAPI.startSession(sessionId);

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

    // Init Modules


    // History is now separate window
    // initHistoryLogic();

    // 1. Check Permissions (Blocking)
    console.log('Checking permissions...');
    await initPermissionsFlow();
    console.log('Permissions check done.');

    // 2. Check onboarding status
    console.log('Checking onboarding...');
    await initOnboarding();
    console.log('Onboarding check done.');

    // Init Sidebar (replaces config/recording screens)
    console.log('Initializing sidebar...');
    await initSidebar(startSessionFlow);

    addLog('Ready');
    console.log('Initialization complete.');
  } catch (error) {
    console.error('Initialization failed:', error);
    addLog(`❌ Init Error: ${error.message}`, 'error');
  }
})();
