# Changelog

## [2.0.0] - 2026-03-18

- Replaced main window with a floating bottom bar (always-on-top, transparent, content-protected)
- Extracted permissions and onboarding flows into separate modal windows
- Added source toggle pills with live device discovery (mic, system audio, camera, screen)
- Display selector dropdown with multi-monitor support
- Recording state UI: icon-only toggles, timer, stop button, pause/resume per track
- Camera bubble toggle independent of recording state
- Renamed sidebar.js to bar.js, cleaned up unused assets

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
