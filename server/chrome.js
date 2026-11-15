// Launches a Chrome that Kane drives (via --cdp-endpoint) and that we watch at
// the same time: screen frames and network requests from every tab, live.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

const CANDIDATES = {
  win32: [
    process.env.KANE_CLI_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
  darwin: [process.env.KANE_CLI_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [process.env.KANE_CLI_CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
};

function findChrome() {
  for (const p of CANDIDATES[process.platform] || CANDIDATES.linux) if (p && fs.existsSync(p)) return p;
  throw new Error("Google Chrome was not found. Set KANE_CLI_CHROME_PATH.");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

async function launch() {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statute-chrome-"));
  const args = [
    "--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1366,900", "--lang=en-GB", "about:blank",
  ];
  if (process.platform === "linux") args.unshift("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu");
  const proc = spawn(findChrome(), args, { stdio: "ignore" });
  const endpoint = `http://127.0.0.1:${port}`;
  let info;
  for (let i = 0; i < 60; i++) {
    try { info = await (await fetch(`${endpoint}/json/version`)).json(); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!info) { proc.kill(); throw new Error("Chrome did not start"); }
  const close = () => {
    try { proc.kill(); } catch {}
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
  };
  return { endpoint, wsUrl: info.webSocketDebuggerUrl, close };
}

// Watches all page targets: forwards screencast frames (throttled) and network
// requests to the callbacks. Uses Node's built-in WebSocket (Node 22+).
function watch(wsUrl, { onFrame, onRequest, fps = 4 }) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, resolve);
    try { ws.send(JSON.stringify(msg)); } catch { resolve(null); }
  });
  const sessions = new Set();
  let lastFrame = 0;
  let activeSession = null;

  async function setup(sid) {
    if (!sid || sessions.has(sid)) return;
    sessions.add(sid);
    activeSession = sid;
    await send("Network.enable", {}, sid);
    await send("Page.enable", {}, sid);
    await send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1100, maxHeight: 720, everyNthFrame: 1 }, sid);
    await send("Runtime.runIfWaitingForDebugger", {}, sid);
  }
  async function attach(targetId) {
    const r = await send("Target.attachToTarget", { targetId, flatten: true });
    await setup(r && r.result && r.result.sessionId);
  }

  ws.addEventListener("open", async () => {
    // New tabs start paused until we have network capture and screencast on.
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await send("Target.setDiscoverTargets", { discover: true });
    const t = await send("Target.getTargets");
    for (const ti of (t && t.result && t.result.targetInfos) || []) if (ti.type === "page") attach(ti.targetId);
  });
  ws.addEventListener("message", (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Target.attachedToTarget") {
      if (m.params.targetInfo.type === "page") setup(m.params.sessionId);
      else send("Runtime.runIfWaitingForDebugger", {}, m.params.sessionId);
    }
    if (m.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }, m.sessionId);
      const now = Date.now();
      if (m.sessionId === activeSession && now - lastFrame >= 1000 / fps) { lastFrame = now; onFrame && onFrame(m.params.data); }
      else if (m.sessionId !== activeSession) { activeSession = m.sessionId; }
    }
    if (m.method === "Network.requestWillBeSent" && onRequest) {
      const r = m.params.request;
      if (/^https?:/.test(r.url)) onRequest({ url: r.url, method: r.method, time: Date.now() });
    }
  });
  return { close: () => { try { ws.close(); } catch {} } };
}

module.exports = { launch, watch, findChrome };
