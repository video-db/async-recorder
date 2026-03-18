/**
 * Floating Bar: Session Control, Source Toggles, Device Selection
 */
import { addLog } from '../utils/logger.js';

// DOM Elements
const elements = {
    btnStart: document.getElementById('btn-start-session'),
    btnStop: document.getElementById('btn-stop-session'),
    btnDelete: document.getElementById('btn-delete-session'),
    btnClose: document.getElementById('btn-close'),

    toggleMic: document.getElementById('toggle-mic'),
    toggleScreen: document.getElementById('toggle-screen'),
    toggleCamera: document.getElementById('toggle-camera'),
    toggleAudio: document.getElementById('toggle-audio'),

    displaySelector: document.getElementById('displaySelector'),

    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),

    mainApp: document.getElementById('mainApp'),

    renameRow: document.getElementById('renameRow'),
    renameInput: document.getElementById('renameInput'),
    renameSaveBtn: document.getElementById('renameSaveBtn'),
};

// State
let activeSessionId = null;
let lastSessionId = null;
let timerInterval = null;
let timerStartedAt = null;

// Device state
let devices = { mics: [], systemAudio: [], displays: [] };
let selectedMicId = null;
let selectedAudioId = null;
let selectedDisplayId = null;

// --- Initialization ---
export async function initBar(onStartSessionCallback) {
    initCloseButton();

    if (elements.btnStart) {
        elements.btnStart.addEventListener('click', () => {
            if (elements.btnStart.disabled) return;
            onStartSessionCallback();
        });
    }

    if (elements.btnStop) {
        elements.btnStop.addEventListener('click', async () => {
            if (!activeSessionId) return;
            await stopSession();
        });
    }

    bindToggleEvents();
    bindRenameEvents();

    // Mic/audio start disabled — only toggleable during active recording
    enableToggles(false);
}

// --- Close Button ---

function initCloseButton() {
    if (elements.btnClose) {
        elements.btnClose.addEventListener('click', () => {
            if (window.recorderAPI && window.recorderAPI.hideBar) {
                window.recorderAPI.hideBar();
            }
        });
    }
}

// --- Session State Management ---

export function setSessionActive(sessionId) {
    activeSessionId = sessionId;
    hideRenameRow();

    // Switch to recording layout
    if (elements.mainApp) elements.mainApp.classList.add('recording');

    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    if (elements.btnStop) elements.btnStop.classList.remove('hidden');
    if (elements.btnDelete) elements.btnDelete.classList.remove('hidden');

    // Mark display pill as active (screen is being captured)
    if (elements.toggleScreen) elements.toggleScreen.classList.add('active');

    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge';
        elements.statusBadge.classList.remove('hidden');
    }
    startTimer();

    enableToggles(true);
}

export function setSessionLoading() {
    if (elements.btnStart) {
        elements.btnStart.disabled = true;
        elements.btnStart.classList.add('loading');
    }
    if (elements.statusBadge) {
        elements.statusBadge.className = 'status-badge starting';
        elements.statusBadge.classList.remove('hidden');
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Starting';
    }
}

export function resetSessionUI() {
    if (activeSessionId) {
        lastSessionId = activeSessionId;
    }
    activeSessionId = null;

    // Switch back to idle layout
    if (elements.mainApp) elements.mainApp.classList.remove('recording');

    if (elements.btnStart) {
        elements.btnStart.classList.remove('hidden', 'loading');
        elements.btnStart.disabled = false;
    }

    // Show rename row if there was a recording
    if (lastSessionId) {
        showRenameRow();
    }
    if (elements.btnStop) {
        elements.btnStop.classList.add('hidden');
        elements.btnStop.disabled = false;
        elements.btnStop.style.opacity = '';
    }
    if (elements.btnDelete) {
        elements.btnDelete.classList.add('hidden');
    }

    stopTimer();
    if (elements.statusBadge) {
        elements.statusBadge.classList.add('hidden');
    }
    if (elements.statusText) {
        elements.statusText.textContent = 'Ready';
    }

    enableToggles(false);
    resetToggles();

    // Reset display pill state
    if (elements.toggleScreen) elements.toggleScreen.classList.remove('active');
}

async function stopSession() {
    if (!activeSessionId) return;

    // Immediate feedback
    if (elements.btnStop) {
        elements.btnStop.disabled = true;
        elements.btnStop.style.opacity = '0.4';
    }

    try {
        const result = await window.recorderAPI.stopSession(activeSessionId);
        if (result.success) {
            addLog('Recording stopped', 'success');
        } else {
            addLog(`Failed to stop: ${result.error}`, 'error');
        }
        resetSessionUI();
    } catch (error) {
        addLog(`Stop error: ${error.message}`, 'error');
        resetSessionUI();
    }
}

// --- Recording Timer ---

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function startTimer() {
    stopTimer();
    timerStartedAt = Date.now();
    if (elements.statusText) {
        elements.statusText.textContent = formatTime(0);
    }
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        if (elements.statusText) {
            elements.statusText.textContent = formatTime(elapsed);
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerStartedAt = null;
}

export function getActiveSessionId() {
    return activeSessionId;
}

// --- Quick Rename ---

function showRenameRow() {
    if (!elements.renameRow || !elements.renameInput) return;
    if (elements.statusBadge) elements.statusBadge.classList.add('hidden');
    if (elements.btnStart) elements.btnStart.classList.add('hidden');
    elements.renameRow.classList.remove('hidden');
    elements.renameInput.value = '';
    elements.renameInput.focus();
}

function hideRenameRow() {
    if (!elements.renameRow) return;
    elements.renameRow.classList.add('hidden');
    if (elements.renameInput) elements.renameInput.value = '';
    if (elements.btnStart && !activeSessionId) {
        elements.btnStart.classList.remove('hidden');
    }
}

async function saveRecordingName() {
    const name = elements.renameInput ? elements.renameInput.value.trim() : '';
    if (!name || !lastSessionId) {
        hideRenameRow();
        return;
    }
    try {
        await window.recorderAPI.updateRecordingName(lastSessionId, name);
        addLog('Recording renamed', 'success');
    } catch (err) {
        addLog(`Rename failed: ${err.message}`, 'error');
    }
    hideRenameRow();
}

function bindRenameEvents() {
    if (elements.renameSaveBtn) {
        elements.renameSaveBtn.addEventListener('click', saveRecordingName);
    }
    if (elements.renameInput) {
        elements.renameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveRecordingName();
            if (e.key === 'Escape') hideRenameRow();
        });
    }
}

// --- Source Toggle Pills ---

function updatePillVisual(el, isActive) {
    if (!el) return;
    const icon = el.querySelector('.source-icon');
    const label = el.querySelector('.source-label');

    if (isActive) {
        el.classList.add('active');
        if (icon && icon.dataset.on) icon.src = icon.dataset.on;
        if (label && label.dataset.on) label.textContent = label.dataset.on;
    } else {
        el.classList.remove('active');
        if (icon && icon.dataset.off) icon.src = icon.dataset.off;
        if (label && label.dataset.off) label.textContent = label.dataset.off;
    }
}

function bindToggleEvents() {
    // Camera — always interactive, app-level toggle for camera bubble
    if (elements.toggleCamera) {
        elements.toggleCamera.addEventListener('click', async () => {
            const isActive = elements.toggleCamera.classList.contains('active');
            const newState = !isActive;
            updatePillVisual(elements.toggleCamera, newState);
            try {
                await window.recorderAPI.toggleCamera(newState);
                addLog(newState ? 'Camera On' : 'Camera Off', 'info');
            } catch (err) {
                console.error(err);
                // Revert visual on failure
                updatePillVisual(elements.toggleCamera, isActive);
            }
        });
    }

    // Mic & Audio — only toggleable during active recording
    const recordingToggles = [
        { el: elements.toggleMic, track: 'mic' },
        { el: elements.toggleAudio, track: 'system_audio' },
    ];

    for (const { el, track } of recordingToggles) {
        if (!el) continue;
        el.addEventListener('click', async () => {
            if (el.classList.contains('disabled')) return;
            if (!activeSessionId) return;

            const isActive = el.classList.contains('active');
            const newState = !isActive;
            updatePillVisual(el, newState);

            try {
                if (newState) {
                    addLog(`Resuming ${track}...`);
                    await window.recorderAPI.resumeTracks(activeSessionId, [track]);
                } else {
                    addLog(`Pausing ${track}...`);
                    await window.recorderAPI.pauseTracks(activeSessionId, [track]);
                }
            } catch (error) {
                addLog(`Failed to toggle ${track}: ${error.message}`, 'error');
                updatePillVisual(el, isActive);
            }
        });
    }
}

function enableToggles(enabled) {
    const toggles = [elements.toggleMic, elements.toggleAudio];
    for (const t of toggles) {
        if (!t) continue;
        if (enabled) {
            t.classList.remove('disabled');
        } else {
            t.classList.add('disabled');
        }
    }
}

function resetToggles() {
    const toggles = [elements.toggleMic, elements.toggleAudio];
    for (const t of toggles) {
        if (t) updatePillVisual(t, true);
    }
}

// --- Device Discovery ---

export async function loadDevices() {
    try {
        const result = await window.recorderAPI.listDevices();
        if (!result.success) {
            console.warn('Failed to list devices:', result.error);
            return;
        }

        devices = result;

        // Mic — set device name and activate pill
        if (devices.mics.length > 0) {
            const mic = devices.mics[0];
            selectedMicId = mic.id;
            const label = elements.toggleMic?.querySelector('.source-label');
            if (label) {
                label.dataset.on = mic.name;
                label.dataset.off = 'No mic';
            }
            updatePillVisual(elements.toggleMic, true);
        }

        // System audio — set device name and activate pill
        if (devices.systemAudio.length > 0) {
            const audio = devices.systemAudio[0];
            selectedAudioId = audio.id;
            const label = elements.toggleAudio?.querySelector('.source-label');
            if (label) {
                label.dataset.on = audio.name;
                label.dataset.off = 'No audio';
            }
            updatePillVisual(elements.toggleAudio, true);
        }

        // Displays — populate dropdown and set default
        populateDisplayDropdown(devices.displays);

        console.log(`[Devices] mics: ${devices.mics.length}, audio: ${devices.systemAudio.length}, displays: ${devices.displays.length}`);
    } catch (err) {
        console.error('Error loading devices:', err);
    }
}

function populateDisplayDropdown(displays) {
    const dropdown = document.getElementById('displayDropdown');
    const label = document.getElementById('displayLabel');
    const selector = document.getElementById('displaySelector');
    if (!dropdown || !label) return;

    dropdown.innerHTML = '';

    if (displays.length === 0) {
        label.textContent = 'No display';
        return;
    }

    // Select the first display by default
    selectedDisplayId = displays[0].id;
    label.textContent = displays[0].name;

    for (const display of displays) {
        const item = document.createElement('button');
        item.className = 'display-dropdown-item' + (display.id === selectedDisplayId ? ' selected' : '');
        item.innerHTML = `<span class="check-mark">${display.id === selectedDisplayId ? '&#10003;' : ''}</span><span>${display.name}</span>`;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedDisplayId = display.id;
            label.textContent = display.name;

            // Update check marks
            dropdown.querySelectorAll('.display-dropdown-item').forEach((el, i) => {
                const isSelected = displays[i].id === selectedDisplayId;
                el.classList.toggle('selected', isSelected);
                el.querySelector('.check-mark').innerHTML = isSelected ? '&#10003;' : '';
            });

            // Close dropdown
            dropdown.classList.remove('visible');
            if (selector) selector.classList.remove('open');
        });
        dropdown.appendChild(item);
    }

    // Display pill click: dropdown in idle mode, pause/resume in recording mode
    const pill = elements.toggleScreen;
    if (pill) {
        pill.addEventListener('click', async (e) => {
            e.stopPropagation();

            // During recording: toggle display track pause/resume
            if (activeSessionId) {
                const isActive = pill.classList.contains('active');
                const newState = !isActive;
                pill.classList.toggle('active', newState);
                try {
                    if (newState) {
                        addLog('Resuming display...');
                        await window.recorderAPI.resumeTracks(activeSessionId, ['screen']);
                    } else {
                        addLog('Pausing display...');
                        await window.recorderAPI.pauseTracks(activeSessionId, ['screen']);
                    }
                } catch (error) {
                    addLog(`Failed to toggle display: ${error.message}`, 'error');
                    pill.classList.toggle('active', isActive);
                }
                return;
            }

            // Idle mode: toggle dropdown
            const isOpen = dropdown.classList.contains('visible');
            dropdown.classList.toggle('visible', !isOpen);
            if (selector) selector.classList.toggle('open', !isOpen);
        });
    }

    // Close on outside click
    document.addEventListener('click', () => {
        dropdown.classList.remove('visible');
        if (selector) selector.classList.remove('open');
    });
}

export function getSelectedChannels() {
    return {
        micId: selectedMicId,
        audioId: selectedAudioId,
        displayId: selectedDisplayId,
    };
}

