document.getElementById("startBtn").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  document.getElementById("status").textContent = res.ok
    ? "Listening..."
    : `Error: ${res.error}`;
});

document.getElementById("stopBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  document.getElementById("status").textContent = "Stopped";
});
