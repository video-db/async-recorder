# Changelog

## [2.0.0] - 2026-03-19

### Floating Bar
- Replaced main window with a minimal floating bottom bar
- Click-through transparent areas so the bar doesn't block apps behind it
- Display picker as a separate floating popup with multi-monitor support
- Source toggles (mic, audio, camera, screen) work before and during recording
- Inline loading state on start button during session initialization
- Tooltips on all bar controls
- Auto-show login on auth failure; logout in system tray
- Extracted permissions and onboarding into separate modal windows

### Library Page Redesign
- Redesigned Library page with sidebar + inline video player layout
- macOS-native title bar with traffic lights integration
- Status badges: Recording (purple), Processing (yellow), Done (green), Error (red)
- Split download button with dropdown (Download Video / Download Transcript)
- Copy Link button with stateful feedback (default → generating → copied + toast)
- Sync button with stateful feedback (default → syncing → synced + toast)
- Client-side search filtering on recording names
- Inline rename with pencil edit button
- Centered video player with native controls
- Toast notifications slide in from top with subtle animation

## [1.5.2] - 2026-03-17

- Redesigned main window with a compact, modern layout
- Recording timer with live duration display
- Quick rename prompt after each recording
- Global keyboard shortcut (`Cmd+Shift+R`) to start/stop recording
- System tray icon with recording state and context menu
- Native notifications for recording events
- Light and dark theme support
- Share link now includes subtitles when available
- Replaced WebSocket with polling for reliable recording export
- Refresh button in history syncs pending recordings from server
- Pre-built DMG downloads for macOS (arm64 + x64)
- Updated VideoDB SDK to v0.2.2

## [1.5.1] - 2025-02-24

- Removed Python backend — all server logic now runs inside Electron (Node.js)
- Replaced Express webhook + Cloudflare tunnel with WebSocket for capture events
- Removed `express`, `cors` dependencies (50 fewer packages)
- Added resilience: polling fallback if WebSocket misses events, orphan session sync on startup
- Updated VideoDB Node SDK to v0.2.1
- Simplified startup to single `npm start` command
- Added DMG build support for macOS
- Migrated to standalone repository

## [1.5.0] - 2025-02-18

- Updated to VideoDB SDK v0.2.0 (npm) and v0.4.0 (Python)
- Added Windows support
- Bug fixes

## [1.0.0] - 2025-02-05

Initial public release.

- Screen, microphone, and system audio capture
- Draggable camera bubble overlay
- Recording history with in-app playback
- Auto-indexing for searchable recordings
- Real-time event delivery via WebSocket
