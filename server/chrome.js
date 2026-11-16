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
    "--window-size=1366,900", "--lang=en-GB", "--disable-crash-reporter", "--disable-breakpad", "about:blank",
  ];
  if (process.platform === "linux") args.unshift("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu");
  // Small servers (512 MB): fewer renderer processes, no background work.
  if (process.env.LOW_MEMORY) args.unshift("--renderer-process-limit=2", "--disable-background-networking", "--disable-component-update", "--disable-features=Translate,OptimizationHints,MediaRouter", "--js-flags=--max-old-space-size=192");
  const bin = findChrome();
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  let errText = "", exited = null;
  proc.stderr.on("data", (d) => { errText = (errText + d).slice(-4000); });
  proc.on("exit", (code, sig) => { exited = sig || code; });
  proc.on("error", (e) => { exited = e.message; });
  const endpoint = `http://127.0.0.1:${port}`;
  let info;
  // A cold container can take a while to start Chrome the first time.
  for (let i = 0; i < 160 && exited === null; i++) {
    try { info = await (await fetch(`${endpoint}/json/version`)).json(); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!info) {
    try { proc.kill(); } catch {}
    const why = errText.split("\n").map((l) => l.trim()).filter((l) => l && !/^\[.*(dbus|Fontconfig|gpu_|viz_main)/i.test(l)).slice(-4).join(" | ");
    console.error("Chrome did not start", bin, exited, "\n" + errText);
    throw new Error(`Chrome did not start${exited !== null ? ` (exited: ${exited})` : " within 40 s"}${why ? ": " + why.slice(0, 400) : ""}`);
  }
  const close = () => {
    try { proc.kill(); } catch {}
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
  };
  return { endpoint, wsUrl: info.webSocketDebuggerUrl, close };
}

// Watches all page targets: takes a screenshot of the tab Kane is using about
// every 0.7 s, and forwards every network request. Uses Node's built-in
// WebSocket (Node 22+).
function watch(wsUrl, { onFrame, onRequest, intervalMs = 700 }) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  // Every call gets an answer within `ms`, even if the tab it targets is gone.
  const send = (method, params = {}, sessionId, ms = 4000) => new Promise((resolve) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const t = setTimeout(() => { pending.delete(msg.id); resolve(null); }, ms);
    pending.set(msg.id, (m) => { clearTimeout(t); resolve(m); });
    try { ws.send(JSON.stringify(msg)); } catch { clearTimeout(t); resolve(null); }
  });
  const sessions = new Set();
  const urls = new Map();  // session -> current URL
  let active = null;      // the tab Kane is working in
  let failures = 0;
  let busy = false;
  let lastData = "";

  async function setup(sid) {
    if (!sid || sessions.has(sid)) return;
    sessions.add(sid);
    if (!active) active = sid;
    await send("Network.enable", {}, sid);
    await send("Page.enable", {}, sid);
    await send("Runtime.runIfWaitingForDebugger", {}, sid);
  }
  async function attach(targetId) {
    const r = await send("Target.attachToTarget", { targetId, flatten: true });
    await setup(r && r.result && r.result.sessionId);
  }

  // Prefer the tab Kane last navigated; skip blank tabs.
  function pick() {
    if (active && sessions.has(active) && !/^about:blank/.test(urls.get(active) || "about:blank")) return active;
    for (const s of [...sessions].reverse()) if (!/^about:blank/.test(urls.get(s) || "about:blank")) return s;
    return null;
  }
  const timer = setInterval(async () => {
    if (busy || !onFrame) return;
    const sid = pick();
    if (!sid) return;
    busy = true;
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 }, sid, 2500);
    busy = false;
    const data = r && r.result && r.result.data;
    if (data) { failures = 0; if (data !== lastData) { lastData = data; onFrame(data); } }
    else if (++failures >= 3) { sessions.delete(sid); urls.delete(sid); if (active === sid) active = null; failures = 0; }
  }, intervalMs);

  ws.addEventListener("open", async () => {
    // New tabs start paused until network capture is on.
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
    if (m.method === "Target.detachedFromTarget") {
      sessions.delete(m.params.sessionId);
      urls.delete(m.params.sessionId);
      if (active === m.params.sessionId) active = [...sessions].pop() || null;
    }
    // Follow Kane: the tab whose main frame last navigated is the one to show.
    if (m.method === "Page.frameNavigated" && !m.params.frame.parentId && m.sessionId) {
      urls.set(m.sessionId, m.params.frame.url);
      if (!/^about:blank/.test(m.params.frame.url)) active = m.sessionId;
    }
    if (m.method === "Network.requestWillBeSent") {
      if (m.params.type === "Document" && m.sessionId) { active = m.sessionId; urls.set(m.sessionId, m.params.request.url); }
      const r = m.params.request;
      if (onRequest && /^https?:/.test(r.url)) onRequest({ url: r.url, method: r.method, time: Date.now() });
    }
  });
  return { close: () => { clearInterval(timer); try { ws.close(); } catch {} } };
}

module.exports = { launch, watch, findChrome };
