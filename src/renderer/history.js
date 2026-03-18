/**
 * History Window Logic
 */

let hlsInstance = null;
let activeRecordingId = null;
let activeRecording = null;
let activeStreamUrl = null;
let refreshInterval = null;

const STATUS_MAP = {
    recording:  { label: 'Recording',   cls: 'status-recording' },
    pending:    { label: 'Processing',   cls: 'status-processing' },
    processing: { label: 'Processing',   cls: 'status-processing' },
    ready:      { label: 'Done',         cls: 'status-done' },
    failed:     { label: 'Error',        cls: 'status-error' },
};

function getStatusInfo(status) {
    return STATUS_MAP[status] || STATUS_MAP.pending;
}

function getDisplayName(recording) {
    if (recording.name) return recording.name;
    if (recording.created_at) {
        const d = new Date(recording.created_at);
        return 'Recording at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return 'Untitled Recording';
}

function formatDuration(recording) {
    if (recording.created_at) {
        return new Date(recording.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return '';
}

// --- Init ---

async function init() {
    loadHistoryList();

    document.getElementById('syncBtn')?.addEventListener('click', handleSync);
    document.getElementById('homeBtn')?.addEventListener('click', () => window.close());
    document.getElementById('shareBtn')?.addEventListener('click', handleShare);
    document.getElementById('editNameBtn')?.addEventListener('click', () => startNameEdit());

    const input = document.getElementById('playerTitleInput');
    if (input) {
        input.addEventListener('blur', () => commitNameEdit());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { cancelNameEdit(); }
        });
    }

    // Download split button
    const downloadChevron = document.getElementById('downloadChevronBtn');
    const downloadMenu = document.getElementById('downloadMenu');
    if (downloadChevron && downloadMenu) {
        downloadChevron.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadMenu.classList.toggle('visible');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.download-split')) {
                downloadMenu.classList.remove('visible');
            }
        });
    }
    document.getElementById('downloadBtn')?.addEventListener('click', () => handleDownloadVideo());
    document.getElementById('downloadVideoBtn')?.addEventListener('click', () => {
        document.getElementById('downloadMenu')?.classList.remove('visible');
        handleDownloadVideo();
    });
    document.getElementById('downloadTranscriptBtn')?.addEventListener('click', () => {
        document.getElementById('downloadMenu')?.classList.remove('visible');
        handleDownloadTranscript();
    });

    // Search (stub — filters list client-side by name)
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.video-item').forEach(item => {
            const title = item.querySelector('.video-item-title')?.textContent.toLowerCase() || '';
            item.style.display = title.includes(query) ? '' : 'none';
        });
    });
}

// --- List ---

async function loadHistoryList() {
    const listContainer = document.getElementById('videoListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state">Loading...</div>';

    try {
        const recordings = await window.recorderAPI.getRecordings();

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No recordings yet.</div>';
            scheduleAutoRefresh([]);
            return;
        }

        recordings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        listContainer.innerHTML = '';

        recordings.forEach(rec => listContainer.appendChild(createVideoListItem(rec)));

        // Auto-select first or preserve selection
        const toSelect = recordings.find(r => r.id === activeRecordingId) || recordings[0];
        if (toSelect) selectRecording(toSelect);

        scheduleAutoRefresh(recordings);
    } catch (error) {
        listContainer.innerHTML = `<div class="empty-state" style="color:#EF3535">Failed to load: ${error.message}</div>`;
    }
}

function scheduleAutoRefresh(recordings) {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    const hasInProgress = recordings.some(r =>
        r.insights_status === 'recording' || r.insights_status === 'pending' || r.insights_status === 'processing'
    );
    if (hasInProgress) {
        refreshInterval = setInterval(loadHistoryList, 5000);
    }
}

function createVideoListItem(recording) {
    const div = document.createElement('div');
    div.className = 'video-item';
    div.dataset.id = recording.id;
    if (recording.id === activeRecordingId) div.classList.add('active');

    const name = getDisplayName(recording);
    const timeStr = formatDuration(recording);
    const status = getStatusInfo(recording.insights_status);

    // Use textContent for name to prevent XSS
    const titleSpan = document.createElement('span');
    titleSpan.className = 'video-item-title';
    titleSpan.textContent = name;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'video-item-time';
    timeSpan.textContent = timeStr;

    const details = document.createElement('div');
    details.className = 'video-item-details';
    details.appendChild(titleSpan);
    details.appendChild(timeSpan);

    const badge = document.createElement('span');
    badge.className = `status-badge ${status.cls}`;
    badge.innerHTML = `<span class="status-icon"><span class="status-dot"></span></span>${status.label}`;

    div.appendChild(details);
    div.appendChild(badge);

    div.addEventListener('click', () => selectRecording(recording));
    return div;
}

// --- Selection ---

function selectRecording(recording) {
    activeRecordingId = recording.id;
    activeRecording = recording;
    updateActiveItemStyle();
    showPlayer(recording);
    updatePlayerHeader(recording);
}

function updateActiveItemStyle() {
    document.querySelectorAll('.video-item').forEach(item => {
        item.classList.toggle('active', Number(item.dataset.id) === activeRecordingId);
    });
}

// --- Player ---

function showPlayer(recording) {
    const video = document.getElementById('historyVideoPlayer');
    const emptyPlayer = document.getElementById('emptyPlayer');
    const playerArea = document.getElementById('videoPlayerArea');
    if (emptyPlayer) emptyPlayer.style.display = 'none';
    if (playerArea) playerArea.style.display = '';

    if (!video) return;

    // Skip reload if the same stream is already playing
    if (recording.stream_url && recording.stream_url === activeStreamUrl) return;

    // Clear previous playback
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    video.removeAttribute('src');
    video.load();
    activeStreamUrl = recording.stream_url || null;

    if (!recording.stream_url) return;

    if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(recording.stream_url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = recording.stream_url;
        video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); }, { once: true });
    }
}

// --- Player Header ---

function updatePlayerHeader(recording) {
    const header = document.getElementById('playerHeader');
    const title = document.getElementById('playerTitle');
    const titleInput = document.getElementById('playerTitleInput');
    const downloadSplit = document.getElementById('downloadSplit');

    if (header) header.style.display = 'flex';

    // Title
    if (title) {
        title.textContent = getDisplayName(recording);
        title.style.display = '';
    }
    if (titleInput) titleInput.style.display = 'none';

    // Share button — enabled when video is ready
    setShareState(recording.video_id ? 'default' : 'disabled');

    // Download split — enabled when stream URL exists
    if (downloadSplit) {
        downloadSplit.classList.toggle('disabled', !recording.stream_url);
    }
}

// --- Editable Name ---

function startNameEdit() {
    if (!activeRecording) return;
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (!title || !titleInput) return;

    title.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
    titleInput.style.display = 'block';
    titleInput.value = getDisplayName(activeRecording);
    titleInput.focus();
    titleInput.select();
}

async function commitNameEdit() {
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (!title || !titleInput || !activeRecording) return;

    const newName = titleInput.value.trim();
    title.style.display = '';
    if (editBtn) editBtn.style.display = '';
    titleInput.style.display = 'none';

    if (newName && newName !== getDisplayName(activeRecording)) {
        activeRecording.name = newName;
        title.textContent = newName;

        // Update the sidebar item
        const item = document.querySelector(`.video-item[data-id="${activeRecording.id}"] .video-item-title`);
        if (item) item.textContent = newName;

        await window.recorderAPI.updateRecordingName(activeRecording.id, newName);
    }
}

function cancelNameEdit() {
    const title = document.getElementById('playerTitle');
    const editBtn = document.getElementById('editNameBtn');
    const titleInput = document.getElementById('playerTitleInput');
    if (title) title.style.display = '';
    if (editBtn) editBtn.style.display = '';
    if (titleInput) titleInput.style.display = 'none';
}

// --- Share ---

function setShareState(state) {
    const btn = document.getElementById('shareBtn');
    const icon = document.getElementById('shareBtnIcon');
    const label = document.getElementById('shareBtnLabel');
    if (!btn || !icon || !label) return;

    btn.classList.remove('processing', 'done');
    btn.disabled = false;

    switch (state) {
        case 'default':
            icon.textContent = 'link';
            label.textContent = 'Copy Link';
            break;
        case 'processing':
            btn.classList.add('processing');
            icon.textContent = '';
            const spinner = document.createElement('span');
            spinner.className = 'btn-spinner';
            icon.appendChild(spinner);
            label.textContent = 'Generating link...';
            break;
        case 'done':
            btn.classList.add('done');
            icon.textContent = 'check';
            label.textContent = 'Link Copied';
            break;
        case 'disabled':
            icon.textContent = 'link';
            label.textContent = 'Copy Link';
            btn.disabled = true;
            break;
    }
}

async function handleShare() {
    if (!activeRecording?.video_id) return;

    setShareState('processing');

    try {
        const result = await window.recorderAPI.getShareUrl(activeRecording.video_id);
        if (result.success && (result.playerUrl || result.streamUrl)) {
            const url = result.playerUrl || result.streamUrl;
            await navigator.clipboard.writeText(url);
            setShareState('done');
            showToast('Link copied to clipboard');
            setTimeout(() => setShareState('default'), 2500);
        } else {
            showToast(result.error || 'Could not generate link');
            setShareState('default');
        }
    } catch (err) {
        showToast('Failed to generate link');
        setShareState('default');
    }
}

// --- Sync ---

function setSyncState(state) {
    const btn = document.getElementById('syncBtn');
    const icon = document.getElementById('syncBtnIcon');
    const label = document.getElementById('syncBtnLabel');
    if (!btn || !icon || !label) return;

    btn.classList.remove('syncing', 'synced');

    switch (state) {
        case 'default':
            icon.textContent = 'sync';
            label.textContent = 'Sync';
            break;
        case 'syncing':
            btn.classList.add('syncing');
            icon.textContent = '';
            const spinner = document.createElement('span');
            spinner.className = 'btn-spinner';
            icon.appendChild(spinner);
            label.textContent = 'Syncing...';
            break;
        case 'synced':
            btn.classList.add('synced');
            icon.textContent = 'check';
            label.textContent = 'Synced';
            break;
    }
}

async function handleSync() {
    setSyncState('syncing');

    try {
        const result = await window.recorderAPI.syncPendingRecordings();
        if (result.success) {
            setSyncState('synced');
            showToast('Recordings synced');
            loadHistoryList();
            setTimeout(() => setSyncState('default'), 2500);
        } else {
            showToast(result.error || 'Sync failed');
            setSyncState('default');
        }
    } catch (err) {
        showToast('Sync failed');
        setSyncState('default');
    }
}

// --- Toast ---

function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
}

// --- Download ---

function handleDownloadVideo() {
    if (!activeRecording?.stream_url) return;
    // Phase 1 stub — backend integration later
    showToast('Download video started');
}

function handleDownloadTranscript() {
    if (!activeRecording) return;
    // Phase 1 stub — backend integration later
    showToast('Download transcript started');
}

// Start
init();
