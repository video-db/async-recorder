/**
 * Sidebar Logic: Permissions, Session Control, Stream Toggles, Settings
 */
import { addLog } from '../utils/logger.js';

// DOM Elements
const elements = {
    // Session Control
    btnStart: document.getElementById('btn-start-session'),
    btnStop: document.getElementById('btn-stop-session'),

    // Toggles
    toggleMic: document.getElementById('toggle-mic'),
    toggleScreen: document.getElementById('toggle-screen'),
    toggleCamera: document.getElementById('toggle-camera'),
    toggleAudio: document.getElementById('toggle-audio'),

    // Status Indicator
    statusText: document.getElementById('statusText'),
    healthDot: document.getElementById('healthDot'),

    // Permission Indicators - Deprecated/Removed from UI

    // Settings & Profile (Same IDs as before)
    settingsBtns: document.querySelectorAll('.btn-settings'),
    // Modals
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    // Inputs
    backendUrl: document.getElementById('settings-backend-url'),
    callbackUrl: document.getElementById('settings-callback-url'),
    // Profile
    profileContainer: document.getElementById('userProfileContainer'),
    profileMenu: document.getElementById('profileMenu'),
    menuLogoutBtn: document.getElementById('menuLogoutBtn')
};

// State
let activeSessionId = null;

// --- Initialization ---
export async function initSidebar(onStartSessionCallback) {
    // 1. Initial Config & Profile Load
    loadConfigToUI();
    initSettingsLogic();
    initProfileLogic();
    resetToggles(); // Initialize toggles to checked state

    // 2. Bind Session Controls
    if (elements.btnStart) {
        elements.btnStart.addEventListener('click', async () => {
            // Disable button prevents double-click
            if (elements.btnStart.disabled) return;
            onStartSessionCallback(); // Trigger start in renderer
        });
    }

    if (elements.btnStop) {
        elements.btnStop.addEventListener('click', async () => {
            if (!activeSessionId) return;
            await stopSession();
        });
    }

    // 3. Bind Stream Toggles
    bindToggleEvents();
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;

    // UI Updates
    if (elements.btnStart) {
        elements.btnStart.disabled = false;
        elements.btnStart.style.display = 'none';
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'flex';
    }

    // Status Indicator
    if (elements.statusText) {
        elements.statusText.textContent = ' Recording';
        elements.statusText.style.color = '#f44336';
    }
    if (elements.healthDot) {
        elements.healthDot.style.background = '#f44336';
        elements.healthDot.style.animation = 'pulse 1s infinite';
    }

    // Enable Toggles
    enableToggles(true);
    // Ensure they show as ON
    resetToggles();
}

export function setSessionLoading() {
    if (elements.btnStart) {
        elements.btnStart.disabled = true;
        elements.btnStart.innerHTML = '<span class="material-icons spin" style="font-size: 16px;">sync</span> Starting...';
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Starting...';
        elements.statusText.style.color = '#f0ad4e';
    }
    if (elements.healthDot) {
        elements.healthDot.style.background = '#f0ad4e';
    }
}

export function resetSessionUI() {
    activeSessionId = null;

    // UI Updates
    if (elements.btnStart) {
        elements.btnStart.style.display = 'flex';
        elements.btnStart.disabled = false;
        elements.btnStart.innerHTML = '<span class="material-icons" style="font-size: 18px;">fiber_manual_record</span> Start Recording';
    }
    if (elements.btnStop) {
        elements.btnStop.style.display = 'none';
    }

    // Status Indicator
    if (elements.statusText) {
        elements.statusText.textContent = 'Ready';
        elements.statusText.style.color = '#ccc';
    }
    if (elements.healthDot) {
        elements.healthDot.style.background = '#4CAF50';
        elements.healthDot.style.animation = 'none';
    }

    // Reset/Disable Toggles
    enableToggles(false);
    resetToggles();
}

async function stopSession() {
    if (!activeSessionId) return;

    try {
        const result = await window.recorderAPI.stopSession(activeSessionId);
        if (result.success) {
            addLog('✅ Recording stopped', 'success');
            resetSessionUI();
        } else {
            addLog(`❌ Failed to stop: ${result.error}`, 'error');
            resetSessionUI();
        }
    } catch (error) {
        addLog(`❌ Stop error: ${error.message}`, 'error');
        resetSessionUI();
    }
}

// Removed updateStatus function

// --- Stream Toggles ---

function bindToggleEvents() {
    // Mic
    if (elements.toggleMic) {
        elements.toggleMic.addEventListener('change', (e) => handleToggle('mic', e.target.checked));
    }
    // Screen
    if (elements.toggleScreen) {
        elements.toggleScreen.addEventListener('change', (e) => handleToggle('screen', e.target.checked));
    }
    // Camera
    if (elements.toggleCamera) {
        elements.toggleCamera.addEventListener('change', (e) => handleToggle('camera', e.target.checked));
    }
    // System Audio (mapped to 'system_audio' track name usually, check binary spec)
    // Binary spec calls it "system_audio" for track name in session, but commands take list of strings.
    // Assuming "system_audio" is the string.
    if (elements.toggleAudio) {
        elements.toggleAudio.addEventListener('change', (e) => handleToggle('system_audio', e.target.checked));
    }
}

async function handleToggle(trackName, isChecked) {
    // Special handling for Camera Window
    if (trackName === 'camera') {
        try {
            await window.recorderAPI.toggleCamera(isChecked);
            addLog(isChecked ? 'Camera On' : 'Camera Off', 'info');
        } catch (err) {
            console.error(err);
        }
        return;
    }

    // If Checked (ON) -> Resume
    // If Unchecked (OFF) -> Pause
    try {
        if (isChecked) {
            addLog(`Resuming ${trackName}...`);
            await window.recorderAPI.resumeTracks(activeSessionId, [trackName]);
        } else {
            addLog(`Pausing ${trackName}...`);
            await window.recorderAPI.pauseTracks(activeSessionId, [trackName]);
        }
    } catch (error) {
        addLog(`❌ Failed to toggle ${trackName}: ${error.message}`, 'error');
        // Revert toggle state on error?
    }
}

function enableToggles(enabled) {
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    toggles.forEach(t => {
        if (t) t.disabled = !enabled;
    });
}

function resetToggles() {
    // Reset to "Checked" (assuming default is ON) or whatever default state
    // Actually default state is usually ON.
    const toggles = [elements.toggleMic, elements.toggleScreen, elements.toggleAudio];
    toggles.forEach(t => {
        if (t) t.checked = true;
    });
}

// --- Permissions ---
// (Permissions are now handled by global permission modal on startup)


// --- Settings & Profile (Copied/Adapted from config.js) ---

function initSettingsLogic() {
    elements.settingsBtns.forEach(btn => {
        btn.addEventListener('click', openSettingsModal);
    });
    if (elements.closeSettingsBtn) elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    if (elements.saveSettingsBtn) elements.saveSettingsBtn.addEventListener('click', saveSettings);

    if (elements.settingsModal) {
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) closeSettingsModal();
        });
    }

    // History Button Listener (Moved here)
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            if (window.recorderAPI && window.recorderAPI.openHistoryWindow) {
                window.recorderAPI.openHistoryWindow();
            } else {
                console.error("History API not available");
            }
        });
    }
}

function openSettingsModal() {
    // Close history modal if open (legacy cleanup)
    const historyModal = document.getElementById('historyModal');
    if (historyModal) historyModal.classList.remove('visible');

    if (elements.settingsModal) elements.settingsModal.classList.add('visible');
    loadConfigToUI();
}

function closeSettingsModal() {
    if (elements.settingsModal) elements.settingsModal.classList.remove('visible');
}

async function saveSettings() {
    const btn = elements.saveSettingsBtn;
    if (btn) {
        btn.textContent = 'Saving...';
        btn.disabled = true;
    }

    try {
        const newConfig = {
            backendBaseUrl: elements.backendUrl.value,
            callbackUrl: elements.callbackUrl.value
        };
        await window.configAPI.updateConfig(newConfig);
        addLog('✅ Settings saved', 'success');
        closeSettingsModal();
    } catch (error) {
        addLog(`❌ Failed to save settings: ${error.message}`, 'error');
    } finally {
        if (btn) {
            btn.textContent = 'Save Changes';
            btn.disabled = false;
        }
    }
}

async function loadConfigToUI() {
    try {
        const config = await window.configAPI.getConfig();
        if (elements.backendUrl) elements.backendUrl.value = config.backendBaseUrl || '';
        if (elements.callbackUrl) elements.callbackUrl.value = config.callbackUrl || '';

        // Update Profile Name
        let displayName = "VideoDB User";
        if (config.userName) {
            displayName = config.userName;
        }

        const tooltip = document.getElementById('userNameTooltip');
        const menuName = document.getElementById('menuUserName');
        if (tooltip) tooltip.textContent = displayName;
        if (menuName) menuName.textContent = displayName;

    } catch (err) {
        console.error("Failed to load config", err);
    }
}

function initProfileLogic() {
    const { profileContainer, profileMenu, menuLogoutBtn } = elements;

    if (profileContainer && profileMenu) {
        profileContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = profileMenu.classList.toggle('visible');
            if (isVisible) profileContainer.classList.add('menu-open');
            else profileContainer.classList.remove('menu-open');
        });

        document.addEventListener('click', () => {
            profileMenu.classList.remove('visible');
            profileContainer.classList.remove('menu-open');
        });

        profileMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', async () => {
            if (profileMenu) profileMenu.classList.remove('visible');
            if (confirm('Are you sure you want to log out?')) {
                await window.configAPI.logout();
                window.location.reload();
            }
        });
    }
}
