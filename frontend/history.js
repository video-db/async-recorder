/**
 * History Window Logic
 */

// HLS player active instance
let hlsInstance = null;
let activeRecordingId = null;

// Mock logger since we don't have the full logger module from renderer (or we can import if path allows)
function addLog(msg, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

async function init() {
    console.log("Initializing History Window...");
    loadHistoryList();

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadHistoryList);
    }

    // Share Button Logic
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', handleShare);
    }

    // Back Button Logic
    const closeBtn = document.getElementById('closeHistoryBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close();
        });
    }
}

async function loadHistoryList() {
    const listContainer = document.getElementById("historyListContainer");
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="empty-state" style="color:#888;">Loading...</div>';

    try {
        // window.recorderAPI MUST be exposed in preload.js for this window too
        // Add limit param (assuming recorderAPI.getRecordings supports args or we handle it in main)
        // Note: recorderAPI.getRecordings calls ipcRenderer.invoke('get-recordings')
        // We need to update main.js handler to pass limit, but current implementation might lack arg passing
        // Let's assume we can fetch all and limit CLIENT side if main doesn't support it yet, 
        // OR better: update main.js handler (but user didn't ask for that, they asked for limit in backend)
        // Since we updated backend route, we should verify main.js passes args. 
        // For now, let's just fetch. The backend default is 20 if we don't pass anything.
        const recordings = await window.recorderAPI.getRecordings();

        if (!recordings || recordings.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No recordings found.</div>';
            return;
        }

        // Filter valid dates and sort
        recordings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        listContainer.innerHTML = "";

        // Grouping Logic
        const grouped = bucketRecordings(recordings);

        for (const [groupName, items] of Object.entries(grouped)) {
            if (items.length === 0) continue;

            // Group Header
            const header = document.createElement("div");
            header.className = "history-group-header";
            header.style.padding = "10px 12px 4px";
            header.style.color = "#888";
            header.style.fontSize = "12px";
            header.style.fontWeight = "600";
            header.style.textTransform = "uppercase";
            header.innerText = groupName;
            listContainer.appendChild(header);

            items.forEach((rec) => {
                const item = createHistoryListItem(rec);
                listContainer.appendChild(item);
            });
        }

        // Auto-play top
        if (recordings.length > 0) {
            loadVideo(recordings[0]);
            updateTranscriptPanel(recordings[0]);
            updateHeader(recordings[0]);
        }

    } catch (error) {
        console.error('[History] Fetch error:', error);
        listContainer.innerHTML = `<div class="empty-state" style="color:#f44336">Failed to load: ${error.message}</div>`;
    }
}

function bucketRecordings(recordings) {
    const buckets = {
        "Today": [],
        "Yesterday": [],
        "Earlier": [] // or specific dates
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    recordings.forEach(rec => {
        if (!rec.created_at) {
            buckets["Earlier"].push(rec);
            return;
        }

        const date = new Date(rec.created_at);
        const dateNoTime = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (dateNoTime.getTime() === today.getTime()) {
            buckets["Today"].push(rec);
        } else if (dateNoTime.getTime() === yesterday.getTime()) {
            buckets["Yesterday"].push(rec);
        } else {
            // For older, we could group by date string, but user asked for "Earlier" or simple buckets
            // Let's use simple Date String keys if we want more granular
            const dateStr = dateNoTime.toLocaleDateString();
            if (!buckets[dateStr]) buckets[dateStr] = [];
            buckets[dateStr].push(rec);
        }
    });

    return buckets;
}

function createHistoryListItem(recording) {
    const div = document.createElement("div");
    div.className = "history-item";
    div.dataset.id = recording.id;

    const timeDisplay = recording.duration ? formatDuration(recording.duration) : "Unknown Duration";
    // Parse Date for display
    const dateObj = recording.created_at ? new Date(recording.created_at) : null;
    const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    const title = `Recording: ${recording.session_id || 'Untitled'}`;

    // Status Badge
    let statusBadge = '';
    // Simplify logic for demo
    if (recording.insights_status === 'ready') {
        statusBadge = '<span class="material-icons" style="font-size:14px; color:#4CAF50;">check_circle</span>';
    } else {
        statusBadge = '<span class="material-icons" style="font-size:14px; color:#888;">pending</span>';
    }

    div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="flex:1;">
             <div style="font-size:13px; font-weight:500; color:#fff; margin-bottom:4px;">${title}</div>
             <div style="font-size:11px; color:#888;">
                <span style="color:#ccc;">${timeStr}</span> • ${timeDisplay}
             </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
            ${statusBadge}
        </div>
    </div>
    `;

    div.addEventListener("click", () => {
        loadVideo(recording);
        updateTranscriptPanel(recording);
        updateHeader(recording);
    });

    return div;
}

function loadVideo(recording) {
    const video = document.getElementById("historyVideoPlayer");
    if (!video) return;

    activeRecordingId = recording.id;
    updateActiveItemStyle();

    if (!recording.stream_url) {
        console.warn("No stream URL");
        return;
    }

    if (Hls.isSupported()) {
        if (hlsInstance) {
            hlsInstance.destroy();
        }
        hlsInstance = new Hls();
        hlsInstance.loadSource(recording.stream_url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(e => console.log("Auto-play prevented:", e));
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = recording.stream_url;
        video.addEventListener('loadedmetadata', () => {
            video.play().catch(e => console.log("Auto-play prevented:", e));
        });
    }
}

function updateHeader(recording) {
    const header = document.getElementById('videoHeader');
    const title = document.getElementById('currentVideoTitle');
    const shareBtn = document.getElementById('shareBtn');

    if (header) header.style.display = 'flex';
    if (title) title.innerText = `Recording: ${recording.session_id || 'Untitled'}`;

    // Store URL for sharing
    if (shareBtn) {
        shareBtn.dataset.url = recording.player_url || recording.stream_url;
    }
}

function handleShare() {
    const shareBtn = document.getElementById('shareBtn');
    const url = shareBtn.dataset.url;

    if (url) {
        navigator.clipboard.writeText(url).then(() => {
            showToast("Link copied to clipboard");
        });
    } else {
        showToast("No link available");
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.querySelector('span:last-child').innerText = message;
        toast.classList.add('visible');
        setTimeout(() => {
            toast.classList.remove('visible');
        }, 3000);
    }
}

function updateTranscriptPanel(recording) {
    const insightsContent = document.getElementById("insightsContent");
    if (!insightsContent) return;

    // Default pending state
    let content = `
        <div style="padding: 20px; text-align:center; color:#666;">
            <div style="margin-bottom:8px;">Generated by VideoDB</div>
            Status: ${recording.insights_status || 'Pending'}
        </div>
    `;

    if (recording.insights_status === 'ready' && recording.insights) {
        try {
            // Check if insights is string or object (backend might return dict now)
            const insightsData = (typeof recording.insights === 'string')
                ? JSON.parse(recording.insights)
                : recording.insights;

            if (insightsData && insightsData.transcript) {
                content = `
                    <div style="padding: 20px; line-height: 1.6; color: #e0e0e0; font-size: 13px;">
                        ${insightsData.transcript.replace(/\n/g, '<br>')}
                    </div>
                `;
            } else {
                content = `
                    <div style="padding: 20px; text-align:center; color:#666;">
                        Transcript not available.
                    </div>
                `;
            }
        } catch (e) {
            console.error("Error parsing insights:", e);
        }
    }

    insightsContent.innerHTML = content;
}

function updateActiveItemStyle() {
    const items = document.querySelectorAll(".history-item");
    items.forEach(item => {
        if (Number(item.dataset.id) === activeRecordingId) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Start
init();
