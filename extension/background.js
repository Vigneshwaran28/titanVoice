// background.js
// MV3 service worker. Coordinates: popup -> tabCapture stream id -> offscreen doc (does the actual
// audio processing + WebSocket to local Whisper server) -> content script (renders overlay).

let isCapturing = false;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["USER_MEDIA"],
    justification: "Capture and process tab audio for live transcription"
  });

  // createDocument() resolves once the document exists, but its script may not
  // have attached its onMessage listener yet. Wait for it to announce itself.
  await waitForOffscreenReady();
}

function waitForOffscreenReady() {
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message.type === "OFFSCREEN_READY") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    // Safety timeout in case the ready ping was missed (e.g. doc already existed)
    setTimeout(resolve, 1500);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "START_CAPTURE") {
      if (isCapturing) {
        sendResponse({ ok: false, error: "Already capturing. Click Stop first." });
        return;
      }

      const tab = await getActiveMeetingTab();
      if (!tab) {
        sendResponse({ ok: false, error: "No Meet/Zoom tab found in focus" });
        return;
      }

      await ensureOffscreenDocument();

      let streamId;
      try {
        // getMediaStreamId must be called from background, then handed to offscreen doc
        streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id
        });
      } catch (err) {
        sendResponse({ ok: false, error: `tabCapture failed: ${err.message}` });
        return;
      }

      isCapturing = true;
      chrome.runtime.sendMessage({
        type: "OFFSCREEN_START",
        streamId,
        tabId: tab.id
      });

      sendResponse({ ok: true });
    }

    if (message.type === "STOP_CAPTURE") {
      isCapturing = false;
      chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
      sendResponse({ ok: true });
    }

    if (message.type === "CAPTURE_FAILED") {
      // offscreen doc reports a failure mid-capture (e.g. getUserMedia rejected)
      isCapturing = false;
    }

    // Relay transcript/suggestion/status events from offscreen doc to the active meeting tab's overlay
    if (
      message.type === "TRANSCRIPT_UPDATE" ||
      message.type === "SUGGESTION_UPDATE" ||
      message.type === "CONNECTION_STATUS"
    ) {
      const tab = await getActiveMeetingTab();
      if (tab) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // content script may not be ready yet; safe to ignore
        });
      }
      sendResponse({ ok: true });
    }
  })();

  return true; // keep the message channel open for async sendResponse
});

async function getActiveMeetingTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://meet.google.com/*", "https://*.zoom.us/*"]
  });
  return tabs[0] || null;
}
