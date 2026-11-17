// Runs one audit at a time: Kane drives a Chrome we watch live, then code
// judges Kane's evidence pack and builds the case file.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const kane = require("../src/kane");
const evidence = require("../src/evidence");
const report = require("../src/report");
const page = require("../src/page");
const chrome = require("./chrome");
const consent = require("../src/packs/consent");

const PACKS = {
  consent,
  "consent-accept": require("../src/packs/consent-accept"),
  cancel: require("../src/packs/cancel"),
  price: require("../src/packs/price"),
};

const DATA = process.env.STATUTE_DATA || path.join(__dirname, "..", "data");
const DAILY_CAP = Number(process.env.DAILY_CAP || 40);
const PER_IP = Number(process.env.PER_IP_CAP || 3);
const CACHE_MS = 24 * 3600 * 1000;
fs.mkdirSync(path.join(DATA, "audits"), { recursive: true });

// --- small persistent state: daily counter and result cache ---
const stateFile = path.join(DATA, "state.json");
let state = { day: "", used: 0, ips: {}, cache: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) }; } catch {}
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
function today() {
  const d = new Date().toISOString().slice(0, 10);
  if (state.day !== d) { state.day = d; state.used = 0; state.ips = {}; state.loops = 0; state.loopIps = {}; save(); }
  return d;
}

// Objective for live audits of any site.
function liveObjective(pack, url) {
  if (pack === "consent") {
    return (
      `Go to ${url}. Before doing anything else on the page, deal with the cookie consent banner or popup if one is shown: ` +
      `click the button that rejects or declines all non-essential cookies; if it only offers settings, open them and choose to reject all. ` +
      `Only after that, open one main page from the site's navigation, then reload that page.`
    );
  }
  return PACKS[pack].objective(url);
}

const jobs = new Map();
const queue = [];
let running = null;

function publicJob(j) {
  return { id: j.id, url: j.label, pack: j.pack, status: j.status, verdict: j.result && j.result.verdict, caseUrl: j.caseUrl };
}

function emit(job, type, data) {
  const ev = { type, ...data };
  if (type === "frame") job.lastFrame = data.data;
  else job.events.push(ev);
  for (const res of job.listeners) res.write(`event: ${type}\ndata: ${JSON.stringify(ev)}\n\n`);
}

function subscribe(id, res) {
  const job = jobs.get(id);
  if (!job) return false;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  for (const ev of job.events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  if (job.lastFrame) res.write(`event: frame\ndata: ${JSON.stringify({ type: "frame", data: job.lastFrame })}\n\n`);
  if (job.status === "done" || job.status === "error") { res.end(); return true; }
  job.listeners.add(res);
  res.on("close", () => job.listeners.delete(res));
  return true;
}

function status() {
  today();
  return { dailyCap: DAILY_CAP, usedToday: state.used, left: Math.max(0, DAILY_CAP - state.used), queue: queue.length, running: !!running };
}

// Create (or reuse from cache) an audit. `target` is { url, label, internal }.
function create({ target, pack, ip }) {
  today();
  const key = `${pack}|${target.label}`;
  const hit = state.cache[key];
  if (hit && Date.now() - hit.at < CACHE_MS && fs.existsSync(path.join(DATA, "audits", hit.id, "result.json"))) {
    return { id: hit.id, cached: true };
  }
  if (state.used >= DAILY_CAP) throw Object.assign(new Error(`Today's ${DAILY_CAP} live audits are used up. Recorded audits are still available below, and the counter resets at midnight UTC.`), { code: 429 });
  if (!target.internal && (state.ips[ip] || 0) >= PER_IP) throw Object.assign(new Error(`You've run ${PER_IP} live audits today. Try again tomorrow, or run Statute yourself from GitHub.`), { code: 429 });
  state.used++;
  if (!target.internal) state.ips[ip] = (state.ips[ip] || 0) + 1;
  save();
  const id = crypto.randomBytes(6).toString("hex");
  const job = { id, pack, target, label: target.label, status: "queued", events: [], listeners: new Set(), key, createdAt: Date.now() };
  jobs.set(id, job);
  queue.push(job);
  emit(job, "queued", { position: queue.length + (running ? 1 : 0), url: target.label, pack });
  pump();
  return { id, cached: false };
}

function loadFinished(id) {
  if (jobs.has(id)) return jobs.get(id);
  const f = path.join(DATA, "audits", id, "result.json");
  if (!/^[a-f0-9]{12}$/.test(id) || !fs.existsSync(f)) return null;
  const saved = JSON.parse(fs.readFileSync(f, "utf8"));
  const job = { id, status: "done", events: saved.events || [], listeners: new Set(), lastFrame: saved.lastFrame, result: saved.result, caseUrl: saved.caseUrl, label: saved.url, pack: saved.pack };
  jobs.set(id, job);
  return job;
}

async function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  queue.forEach((j, i) => emit(j, "queued", { position: i + 2 }));
  try { await (running.kind === "loop" ? require("./loop").runLoop(running) : runJob(running)); } catch (e) {
    running.status = "error";
    emit(running, "error", { message: e.message || String(e) });
  } finally {
    for (const res of running.listeners) res.end();
    running.listeners.clear();
    running = null;
    pump();
  }
}

// One Kane run that we watch live: frames and requests stream to the job, then
// code judges Kane's sealed evidence. Used by audits and by the live loop.
async function observe(job, { url, objective, pack, dir, strict = false, phase }) {
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  const cloud = job.country && process.env.LT_USERNAME && process.env.LT_ACCESS_KEY;
  if (job.country && !cloud) throw new Error("Auditing from another country needs LT_USERNAME and LT_ACCESS_KEY set in the environment.");
  const browser = cloud ? null : await chrome.launch();
  let rejectAt = null;
  const seen = [];
  const watcher = cloud ? { close() {} } : chrome.watch(browser.wsUrl, {
    onFrame: (data) => emit(job, "frame", { data }),
    onRequest: (r) => {
      let u;
      try { u = new URL(r.url); } catch { return; }
      if (/favicon\.ico$/.test(u.pathname)) return;
      const tracker = consent.matchDomain(u);
      const item = { method: r.method, url: (u.host + u.pathname).slice(0, 120), tracker: tracker || null, after: rejectAt != null && r.time >= rejectAt, t: r.time, phase };
      seen.push(item);
      emit(job, "request", item);
    },
  });

  let res;
  try {
    res = await kane.run(objective, {
      maxSteps: Number(process.env.MAX_STEPS || 16),
      timeout: Number(process.env.RUN_TIMEOUT || 210),
      cdpEndpoint: cloud ? undefined : browser.endpoint,
      wsEndpoint: cloud ? kane.cloudEndpoint({ country: job.country, username: process.env.LT_USERNAME, accessKey: process.env.LT_ACCESS_KEY, name: `Statute ${job.country}` }) : undefined,
      username: process.env.LT_USERNAME,
      accessKey: process.env.LT_ACCESS_KEY,
      onEvent: (e) => {
        if (e.step && e.status && e.status !== "running") {
          const remark = String(e.remark || "");
          if (rejectAt == null && e.status === "done" && /^click\b/i.test(remark) && /(reject|decline|refuse|deny|necessary only|essential only)/i.test(remark)) {
            rejectAt = Date.now() - 1500;
            emit(job, "reject", { at: rejectAt, label: consent.cleanLabel(remark), phase });
          }
          emit(job, "step", { n: e.step, status: e.status, remark: remark.replace(/^(\w+):\s*/, (m, k) => `${k}: `), phase });
        }
      },
    });
  } finally {
    watcher.close();
    if (browser) browser.close();
  }
  if (!res.end) {
    // Keep Kane's full error output so a failed run can be diagnosed later.
    fs.writeFileSync(path.join(dir, "kane-stderr.txt"), res.stderr || "");
    fs.writeFileSync(path.join(dir, "kane-events.ndjson"), (res.events || []).map((e) => JSON.stringify(e)).join("\n"));
    const lines = [...(res.events || []).filter((e) => /error|fail/i.test(e.type || "") || e.error || e.message).map((e) => e.message || e.error || JSON.stringify(e).slice(0, 200)), ...(res.stderr || "").split("\n")].map((l) => String(l).trim()).filter(Boolean);
    const useful = lines.filter((l) => /error|fail|denied|limit|queue|parallel|session|unauthor|invalid|timeout|refused|exceed/i.test(l)).slice(-3);
    throw new Error("Kane stopped without a result. " + (useful.length ? useful : lines.slice(-3)).join(" | "));
  }

  // Judge from Kane's sealed evidence pack; fall back to our own live capture
  // only if the pack has no network recording.
  let packPath = res.end.session_dir ? evidence.newestPack(res.end.session_dir) : null;
  if (packPath) {
    const copy = path.join(dir, "evidence", `${pack}-${Date.now()}.evidence`);
    fs.copyFileSync(packPath, copy);
    packPath = copy;
  }
  let network = packPath ? evidence.networkFromPack(packPath) : { requests: [], actions: [], harFiles: 0 };
  let source = "kane";
  if (!network.harFiles && seen.length) {
    source = "live";
    network = { ...network, harFiles: 1, requests: seen.map((s) => ({ url: `https://${s.url}`, method: s.method, time: new Date(s.t).toISOString(), setCookies: [], sentCookies: [] })) };
  }
  if (rejectAt) network.liveRejectAt = rejectAt;
  const pk = PACKS[pack];
  const result = pk.judge({ end: res.end, events: res.events, network, strict });
  fs.writeFileSync(path.join(dir, `${pack}.last-run.json`), JSON.stringify({ end: res.end, events: res.events, packPath }, null, 2));
  report.write(dir, pk, result, { evidence: packPath && path.basename(packPath), testUrl: res.end.test_url || network.shareLink, credits: res.end.credits_consumed, kaneStatus: res.end.status, kaneSummary: res.end.summary });
  return { result, packPath, end: res.end, run: res.end.test_url || network.shareLink || null, credits: Number(res.end.credits_consumed) || 0, source };
}

async function runJob(job) {
  job.status = "running";
  const dir = path.join(DATA, "audits", job.id);
  emit(job, "started", { url: job.label, pack: job.pack });
  const o = await observe(job, { url: job.target.url, objective: liveObjective(job.pack, job.target.url), pack: job.pack, dir });
  const result = o.result;
  job.kaneEnd = o.end;
  page.build({ out: dir, packs: PACKS, url: job.label });
  job.result = result;
  job.caseUrl = `/audits/${job.id}/`;
  job.status = "done";
  emit(job, "verdict", { verdict: result.verdict, why: result.why, result, caseUrl: job.caseUrl, run: o.run, credits: o.end.credits_consumed, source: o.source });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ url: job.label, pack: job.pack, result, caseUrl: job.caseUrl, events: job.events, lastFrame: job.lastFrame }));
  state.cache[job.key] = { id: job.id, at: Date.now() };
  save();
}

// Run one audit directly (used by the Census), outside the public queue and caps.
async function runDirect({ url, label, pack = "consent", country, onEvent }) {
  const id = crypto.randomBytes(6).toString("hex");
  const job = { id, pack, country, target: { url, label, internal: true }, label, status: "queued", events: [], listeners: new Set(), key: `census|${pack}|${label}`, createdAt: Date.now() };
  if (onEvent) job.listeners.add({ write: (chunk) => { const m = chunk.match(/^event: (\w+)\ndata: (.*)\n\n$/s); if (m && m[1] !== "frame") onEvent(JSON.parse(m[2])); }, end() {} });
  jobs.set(id, job);
  try { await runJob(job); } catch (e) { job.status = "error"; job.error = e.message; }
  return job;
}

// Queue a live loop (Kane finds it, Claude Code fixes it, Kane proves it).
function createLoop({ ip }) {
  today();
  const cap = Number(process.env.LOOP_DAILY_CAP || 6);
  state.loops = state.loops || 0;
  state.loopIps = state.loopIps || {};
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("Live loops are switched off on this server (no Claude Code token). Watch the recorded run above."), { code: 503 });
  if (state.loops >= cap) throw Object.assign(new Error(`Today's ${cap} live loops are used up. Watch the recorded run above, or the last live one; the counter resets at midnight UTC.`), { code: 429 });
  if ((state.loopIps[ip] || 0) >= 1) throw Object.assign(new Error("You've run a live loop today. Thanks for watching; try again tomorrow."), { code: 429 });
  state.loops++;
  state.loopIps[ip] = (state.loopIps[ip] || 0) + 1;
  save();
  const id = crypto.randomBytes(6).toString("hex");
  const job = { id, kind: "loop", pack: "consent", target: { label: "Lumen with Google's tag pasted in", internal: true }, label: "live loop", status: "queued", events: [], listeners: new Set(), createdAt: Date.now() };
  jobs.set(id, job);
  queue.push(job);
  emit(job, "queued", { position: queue.length + (running ? 1 : 0) });
  pump();
  return { id };
}

function loopStatus() {
  today();
  const cap = Number(process.env.LOOP_DAILY_CAP || 6);
  return { enabled: !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY), cap, left: Math.max(0, cap - (state.loops || 0)), busy: !!running || queue.length > 0, last: state.lastLoop || null };
}
function rememberLoop(id) { state.lastLoop = id; save(); }

module.exports = { create, createLoop, loopStatus, rememberLoop, observe, emit, subscribe, status, loadFinished, runDirect, jobs, DATA, PACKS };
