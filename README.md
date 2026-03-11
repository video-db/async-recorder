<!-- PROJECT SHIELDS -->
[![Electron][electron-shield]][electron-url]
[![Node][node-shield]][node-url]
[![License][license-shield]][license-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Website][website-shield]][website-url]

<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="https://videodb.io/">
    <img src="https://codaio.imgix.net/docs/_s5lUnUCIU/blobs/bl-RgjcFrrJjj/d3cbc44f8584ecd42f2a97d981a144dce6a66d83ddd5864f723b7808c7d1dfbc25034f2f25e1b2188e78f78f37bcb79d3c34ca937cbb08ca8b3da1526c29da9a897ab38eb39d084fd715028b7cc60eb595c68ecfa6fa0bb125ec2b09da65664a4f172c2f" alt="Logo" width="300" height="">
  </a>

  <h1 align="center">Async Recorder</h1>

  <p align="center">
    A Loom-style screen recording app built with Electron and the VideoDB Capture SDK.
    <br />
    <a href="https://docs.videodb.io"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="#features">View Features</a>
    ·
    <a href="#quick-start">Quick Start</a>
    ·
    <a href="https://github.com/video-db/async-recorder/issues">Report Bug</a>
  </p>
</p>

<p align="center">
  <strong>Platform Support:</strong> macOS and Windows
</p>

---

## Features

- Screen + microphone + system audio capture via [VideoDB Capture SDK](https://docs.videodb.io)
- Draggable camera bubble overlay
- Real-time session events via WebSocket
- Recording history with pipeline status tracking (Recording → Processing → Transcription → Ready)
- Editable recording names
- Auto-indexing with transcript generation and subtitles
- On-demand share link generation
- In-app video playback (HLS)

## Prerequisites

- Node.js 16+
- VideoDB API Key ([console.videodb.io](https://console.videodb.io))

## Quick Start

```bash
npm install
npm start
```

On first launch, grant microphone and screen recording permissions, then enter your name and VideoDB API key.

## Usage

1. **Connect** — Enter your name and API key on first launch
2. **Record** — Click "Start Recording" to capture screen, mic, and system audio
3. **Camera** — Toggle the camera bubble overlay from source controls
4. **Review** — Click the history icon to browse past recordings, view transcripts, and share links
5. **Share** — Click "Share" on any recording to generate a fresh link via the VideoDB API

## Architecture

```
Electron Main Process
├── VideoDB Node SDK (videodb ^0.2.2)
│   ├── CaptureClient (local capture via native binary)
│   ├── WebSocket (real-time session events)
│   └── Connection (API: sessions, tokens, video ops)
├── SQLite (sql.js, pure JS — users + recordings)
└── IPC Handlers (bridge to renderer)
```

**Event flow:** The app connects a WebSocket before each recording session. When recording stops, the server-side export triggers a `capture_session` event over WebSocket with the video ID, stream URL, and player URL. A polling fallback syncs any missed events on app restart.

**Post-recording:** Once a video is exported, the app automatically indexes spoken words, generates a transcript, and creates a subtitled stream — all via the VideoDB SDK.

## Project Structure

```
├── frontend/
│   ├── main.js          # Electron main process + IPC handlers
│   ├── preload.js       # Context bridge (renderer ↔ main)
│   ├── index.html       # Main window (recorder controls)
│   ├── renderer.js      # Main window renderer
│   ├── camera.*         # Camera bubble overlay
│   ├── history.*        # Recording history window
│   ├── src/
│   │   ├── ui/          # Onboarding, permissions, sidebar
│   │   └── utils/       # Logger, permission helpers
│   └── server/          # In-process backend modules
│       ├── database.js          # SQLite via sql.js
│       ├── videodb-service.js   # VideoDB SDK wrapper
│       └── insights-service.js  # Transcript + subtitle indexing
├── package.json
└── .env                 # Optional: VIDEODB_API_URL override
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VIDEODB_API_URL` | Override the VideoDB API base URL (for dev/staging) | Production API |

Set in a `.env` file at the project root, or as an environment variable.

## Troubleshooting

### Permissions denied
- **macOS**: System Settings → Privacy & Security → enable Screen Recording / Microphone / Camera
- **Windows**: Settings → Privacy → enable Microphone / Camera access

### Camera not showing
- Toggle camera off/on in source controls
- Check Camera permission in system settings

### Reset
```bash
# Delete the app database (stored in Electron userData)
# macOS
rm ~/Library/Application\ Support/async-recorder/async-recorder.db
rm ~/Library/Application\ Support/async-recorder/config.json
```
Then run `npm start`

## Building

```bash
# Build directory (for testing)
npm run pack

# Build DMG installer (macOS arm64)
npm run dist
```

## License

MIT

## Community & Support

- **Docs**: [docs.videodb.io](https://docs.videodb.io)
- **Issues**: [GitHub Issues](https://github.com/video-db/async-recorder/issues)
- **Discord**: [Join community](https://discord.gg/py9P639jGz)
- **Console**: [Get API key](https://console.videodb.io)

---

<p align="center">Made with ❤️ by the <a href="https://videodb.io">VideoDB</a> team</p>

---

<!-- MARKDOWN LINKS & IMAGES -->
[electron-shield]: https://img.shields.io/badge/Electron-39.0-47848F?style=for-the-badge&logo=electron&logoColor=white
[electron-url]: https://www.electronjs.org/
[node-shield]: https://img.shields.io/badge/Node.js-16+-339933?style=for-the-badge&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/
[license-shield]: https://img.shields.io/github/license/video-db/async-recorder.svg?style=for-the-badge
[license-url]: https://github.com/video-db/async-recorder/blob/main/LICENSE
[stars-shield]: https://img.shields.io/github/stars/video-db/async-recorder.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/async-recorder/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/async-recorder.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/async-recorder/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
