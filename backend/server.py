"""
whisper-server/server.py

Local WebSocket server that:
1. Accepts raw 16kHz PCM16 audio chunks from the Chrome extension (offscreen.js)
2. Buffers and transcribes them using faster-whisper (free, open source, local)
3. Sends transcript text back to the extension
4. Calls a local LLM (via Ollama) for a sales suggestion based on the transcript
5. Sends the suggestion back too

Run with:
    pip install faster-whisper websockets numpy requests
    python server.py

Requires Ollama running locally with a model pulled, e.g.:
    ollama pull llama3.2
    ollama serve
"""

import asyncio
import json
import logging
import numpy as np
import websockets
import requests
from faster_whisper import WhisperModel

# ---- Logging setup: writes to both console and titanhand.log file ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("titanhand.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("titanhand")

# ---- Config ----
MODEL_SIZE = "base"          # tiny/base/small/medium/large-v3 — bigger = more accurate, slower
SAMPLE_RATE = 16000
BUFFER_SECONDS = 4            # how much audio to accumulate before transcribing
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2"

SALES_SYSTEM_PROMPT = """You are a real-time sales coaching assistant listening to a live \
sales call. You will be given the latest thing the CLIENT said. Respond with ONE short, \
natural sentence (max 15 words) the salesperson could say next to handle objections, \
build rapport, or move toward closing the deal. Do not add explanations, only the suggested line.

Client said: "{transcript}"

Suggested response:"""

log.info(f"Loading Whisper model '{MODEL_SIZE}'... (first run downloads weights)")
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
log.info("Model loaded.")


def _llm_request_blocking(transcript: str) -> str:
    prompt = SALES_SYSTEM_PROMPT.format(transcript=transcript)
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=60,  # first call loads the model into memory, can be slow
        )
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except Exception as e:
        log.error(f"Ollama call failed: {e}")
        return "(suggestion engine offline)"


async def get_llm_suggestion(transcript: str) -> str:
    # Run the blocking HTTP call in a thread so it doesn't stall the
    # WebSocket event loop (which would trigger keepalive ping timeouts).
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _llm_request_blocking, transcript)


async def handle_connection(websocket):
    log.info("Client connected")
    audio_buffer = bytearray()
    bytes_per_second = SAMPLE_RATE * 2  # 16-bit PCM = 2 bytes/sample
    buffer_threshold = bytes_per_second * BUFFER_SECONDS

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                audio_buffer.extend(message)

                if len(audio_buffer) >= buffer_threshold:
                    pcm = np.frombuffer(bytes(audio_buffer), dtype=np.int16)
                    audio_float = pcm.astype(np.float32) / 32768.0
                    audio_buffer.clear()

                    segments, _ = model.transcribe(audio_float, language="en", beam_size=1)
                    text = " ".join(seg.text.strip() for seg in segments).strip()

                    if text:
                        log.info(f"Transcript: {text}")
                        await websocket.send(json.dumps({
                            "type": "transcript",
                            "text": text,
                            "is_final": True
                        }))

                        suggestion = await get_llm_suggestion(text)
                        log.info(f"Suggestion: {suggestion}")
                        await websocket.send(json.dumps({
                            "type": "suggestion",
                            "text": suggestion,
                            "category": "general"
                        }))
    except websockets.exceptions.ConnectionClosed as e:
        log.warning(f"Client disconnected: {e}")
    except Exception as e:
        log.exception(f"Unexpected error in connection handler: {e}")
    finally:
        log.info("Connection handler finished")


async def main():
    # Warm up Ollama once at startup so the model is already loaded into
    # memory before the first real transcript arrives.
    log.info("Warming up Ollama model (loading into memory)...")
    await get_llm_suggestion("Hello, just checking pricing.")
    log.info("Ollama warm-up done.")

    async with websockets.serve(
        handle_connection, "localhost", 8765,
        ping_interval=20, ping_timeout=60  # tolerate slow LLM calls without dropping the connection
    ):
        log.info("Whisper WebSocket server running at ws://localhost:8765/stream")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
