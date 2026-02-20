<!-- PROJECT SHIELDS -->
[![Electron][electron-shield]][electron-url]
[![Node][node-shield]][node-url]
[![Python][python-shield]][python-url]
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

- Screen + microphone + system audio capture
- Draggable camera bubble overlay
- In-app video playback
- Recording history with search
- Auto-indexing for searchable recordings

## Screenshots

| Main Window | Recording |
|-------------|-----------|
| ![Main](screenshots/main.png) | ![Recording](screenshots/recording.png) |

| Camera Bubble | History |
|---------------|---------|
| ![Camera](screenshots/camera.png) | ![History](screenshots/history.png) |

## Prerequisites

- Node.js 16+
- Python 3.10+ ([download](https://python.org/downloads/))
- VideoDB API Key ([console.videodb.io](https://console.videodb.io))

## Quick Start

```bash
npm install
npm run setup    # Enter your VideoDB API key
npm start
```

> **Note**: On first run, close the app and run `npm start` again after setup completes.

## Usage

1. **Connect**: Enter your name and API key on first launch
2. **Record**: Click "Start Recording" - grant permissions when prompted
3. **Camera**: Toggle the camera bubble from the sidebar
4. **Review**: Click the history icon to view past recordings

## Troubleshooting

### Permissions denied
- **macOS**: System Settings → Privacy & Security → enable Screen Recording/Microphone/Camera
- **Windows**: Settings → Privacy → enable Microphone/Camera access

### Backend won't start
- Delete `server/venv` and run `npm start` again
- Make sure Python is installed and in PATH

### Camera not showing
- Toggle camera off/on in the sidebar
- Check Camera permission in system settings

### Reset
```bash
# macOS/Linux
rm -rf server/venv server/users.db runtime.json

# Windows
rmdir /s /q server\venv
del server\users.db runtime.json
```
Then run `npm run setup && npm start`

## Project Structure

```
├── frontend/        # Electron app (UI)
│   ├── main.js      # Main process
│   ├── renderer.js  # UI logic
│   ├── index.html   # Main window
│   ├── camera.*     # Camera bubble
│   └── history.*    # Recording history
├── server/          # Python backend (FastAPI)
└── scripts/         # Setup and startup scripts
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
[python-shield]: https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white
[python-url]: https://www.python.org/
[license-shield]: https://img.shields.io/github/license/video-db/async-recorder.svg?style=for-the-badge
[license-url]: https://github.com/video-db/async-recorder/blob/main/LICENSE
[stars-shield]: https://img.shields.io/github/stars/video-db/async-recorder.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/async-recorder/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/async-recorder.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/async-recorder/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
