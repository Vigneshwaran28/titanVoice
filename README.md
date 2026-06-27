# TitanHand — Live Sales Call Assist

Free/open-source stack. Listens to a Google Meet / Zoom Web call, transcribes
speech locally (faster-whisper), and shows an AI-suggested response (via a
local LLM through Ollama) in an overlay on the call page.

## Folder structure

```
titanHand/
├── extension/        <- load this folder as the Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── offscreen.js / offscreen.html
│   ├── content.js / overlay.css
│   ├── popup.html / popup.js
│   └── icons/
└── backend/           <- run this as a local server (separate from the extension)
    ├── server.py
    ├── requirements.txt
    └── start.bat       <- double-click or run from terminal on Windows
```

## 1. Start the backend

**Prerequisite:** Ollama installed and running, with a model pulled:
```powershell
ollama pull llama3.2
ollama list   # confirm it shows llama3.2
```
(If `ollama list` works, Ollama is already running in the background — you do
not need to run `ollama serve` manually.)

**Then start the backend:**
```powershell
cd backend
start.bat
```
This creates a virtual environment, installs dependencies, and starts the
server. Wait until you see:
```
Warming up Ollama model (loading into memory)...
Ollama warm-up done.
Whisper WebSocket server running at ws://localhost:8765/stream
```
The warm-up step can take 30–60+ seconds the first time (loading the model
into memory). Leave this terminal window open and running during your call.

## 2. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension` folder (not the whole `titanHand` folder — just
   `extension`)

## 3. Use it

1. Join a Google Meet or Zoom Web call
2. Click the TitanHand icon in the Chrome toolbar → **Start Listening**
3. Approve the tab capture permission if prompted
4. The TitanHand overlay box appears top-right inside the call, showing the
   live transcript and a suggested line to say next
5. Click **Stop** in the popup when the call ends

## New: connection status + logging

- The overlay header now has a small colored dot next to "TitanHand": green =
  connected to backend, yellow = connecting, red = disconnected. Also added a
  ✕ close button and — minimize button.
- The backend now writes everything to `backend/titanhand.log` (in addition to
  the terminal). If something breaks, just send me that log file instead of
  screenshots — it has timestamps, every transcript, every suggestion, and
  full error tracebacks.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Cannot read properties of undefined (reading 'createDocument')" | `offscreen` permission missing | Already fixed in this version's manifest.json |
| "Receiving end does not exist" | Offscreen doc wasn't ready yet | Already fixed — background.js now waits for a ready signal |
| "Cannot capture a tab with an active stream" | Clicked Start twice without Stop | Already guarded against — but always click Stop before starting again |
| Ollama `Read timed out` / WebSocket `keepalive ping timeout` crash | Backend's old timeout (10s) too short for first model load | Already fixed — timeout raised to 60s, call moved off the main loop, server pings tolerate slow responses |
| Suggestion text never updates | Backend not running, or wrong folder/version running | Confirm the backend terminal shows the **warm-up** message — if it doesn't, you're running an old copy of server.py |
| Only your own voice transcribes, not the client's | `chrome.tabCapture` captures mixed tab audio (you + client together) | Expected at this stage — see "Known limitations" below |

## Known limitations (current MVP)

- No speaker separation — both sides of the call are captured as one mixed
  audio stream. Fine for testing the suggestion loop; for proper diarization
  later, the better approach is a meeting-bot (e.g. Puppeteer joins the call
  as a silent participant) rather than `tabCapture`.
- No consent banner yet. **Add this before testing on a real client call** —
  many regions legally require disclosure that a call is being transcribed/
  analyzed by AI.
- No sales-playbook RAG yet — suggestions are generic, not tailored to your
  specific product or script.
- Uses the deprecated `ScriptProcessorNode` for audio processing (works fine,
  but should move to `AudioWorklet` before any real deployment).
