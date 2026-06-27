// offscreen.js
// Runs in the hidden offscreen document. Has access to getUserMedia using the
// streamId handed over from background.js. Streams raw audio chunks to a local
// WebSocket server (see whisper-server/server.py) which transcribes + returns text.

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let socket = null;

const WHISPER_WS_URL = "ws://localhost:8765/stream";

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === "OFFSCREEN_START") {
    await startCapture(message.streamId);
  }
  if (message.type === "OFFSCREEN_STOP") {
    stopCapture();
  }
});

// Tell background.js this document's listener is attached and ready
chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" });

async function startCapture(streamId) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
  } catch (err) {
    console.error("Failed to capture tab audio:", err);
    chrome.runtime.sendMessage({ type: "CAPTURE_FAILED", error: err.message });
    return;
  }

  // Keep audio audible on the page too (otherwise capturing mutes the tab)
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  const passthrough = audioContext.createMediaStreamDestination();
  source.connect(audioContext.destination); // so user still hears the call
  source.connect(passthrough);

  // ScriptProcessor is deprecated but simplest for a prototype.
  // Swap for AudioWorklet before production use.
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  source.connect(processorNode);
  processorNode.connect(audioContext.destination);

  connectSocket();

  processorNode.onaudioprocess = (event) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const inputData = event.inputBuffer.getChannelData(0);
    const pcm16 = floatTo16BitPCM(inputData);
    socket.send(pcm16);
  };
}

function connectSocket() {
  chrome.runtime.sendMessage({ type: "CONNECTION_STATUS", status: "connecting" });

  socket = new WebSocket(WHISPER_WS_URL);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    chrome.runtime.sendMessage({ type: "CONNECTION_STATUS", status: "connected" });
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "transcript") {
      chrome.runtime.sendMessage({
        type: "TRANSCRIPT_UPDATE",
        text: data.text,
        isFinal: data.is_final
      });
    }
    if (data.type === "suggestion") {
      chrome.runtime.sendMessage({
        type: "SUGGESTION_UPDATE",
        text: data.text,
        category: data.category
      });
    }
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    chrome.runtime.sendMessage({ type: "CONNECTION_STATUS", status: "disconnected" });
  };

  socket.onclose = () => {
    console.log("WebSocket closed");
    chrome.runtime.sendMessage({ type: "CONNECTION_STATUS", status: "disconnected" });
  };
}

function stopCapture() {
  if (processorNode) processorNode.disconnect();
  if (audioContext) audioContext.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (socket) socket.close();
  mediaStream = null;
  audioContext = null;
  processorNode = null;
  socket = null;
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }
  return buffer;
}
