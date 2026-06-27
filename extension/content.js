// content.js
// Injects a floating overlay into the meeting page showing live transcript
// and AI suggestions. Listens for messages relayed from background.js.

function createOverlay() {
  if (document.getElementById("sc-overlay-root")) return;

  const root = document.createElement("div");
  root.id = "sc-overlay-root";
  root.innerHTML = `
    <div id="sc-drag-handle">
      <span>TitanHand</span>
      <span id="sc-status" title="Backend connection status">●</span>
      <span id="sc-controls">
        <span id="sc-minimize" title="Minimize">—</span>
        <span id="sc-close" title="Close">✕</span>
      </span>
    </div>
    <div id="sc-body">
      <div id="sc-transcript-label">Live transcript</div>
      <div id="sc-transcript"></div>
      <div id="sc-suggestion-label">Suggested response</div>
      <div id="sc-suggestion">Listening for the client...</div>
    </div>
  `;
  document.body.appendChild(root);
  makeDraggable(root, document.getElementById("sc-drag-handle"));

  document.getElementById("sc-minimize").addEventListener("click", (e) => {
    e.stopPropagation();
    const body = document.getElementById("sc-body");
    body.style.display = body.style.display === "none" ? "block" : "none";
  });

  document.getElementById("sc-close").addEventListener("click", (e) => {
    e.stopPropagation();
    root.remove();
  });
}

function makeDraggable(el, handle) {
  let offsetX = 0, offsetY = 0, isDown = false;
  handle.addEventListener("mousedown", (e) => {
    isDown = true;
    offsetX = e.clientX - el.offsetLeft;
    offsetY = e.clientY - el.offsetTop;
  });
  document.addEventListener("mouseup", () => (isDown = false));
  document.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    el.style.left = `${e.clientX - offsetX}px`;
    el.style.top = `${e.clientY - offsetY}px`;
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRANSCRIPT_UPDATE") {
    const el = document.getElementById("sc-transcript");
    if (el) el.textContent = message.text;
  }
  if (message.type === "SUGGESTION_UPDATE") {
    const el = document.getElementById("sc-suggestion");
    if (el) el.textContent = message.text;
  }
  if (message.type === "CONNECTION_STATUS") {
    const dot = document.getElementById("sc-status");
    if (dot) {
      dot.className = message.status; // "connected" | "disconnected" | "connecting"
      dot.title = `Backend: ${message.status}`;
    }
  }
});

createOverlay();
