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
  if (state.day !== d) { state.day = d; state.used = 0; state.ips = {}; save(); }
  return d;
}

// Objective for live audits of any site.
function liveObjective(pack, url) {
  if (pack === "consent") {
    return (
      `Go to ${url}. If a cookie consent banner or popup appears, click the button that rejects or declines ` +
      `all non-essential cookies; if it only offers settings, open them and choose to reject all. ` +
      `Then open one main page from the site's navigation. Then reload the page.`
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
  try { await runJob(running); } catch (e) {
    running.status = "error";
    emit(running, "error", { message: e.message || String(e) });
  } finally {
    for (const res of running.listeners) res.end();
    running.listeners.clear();
    running = null;
    pump();
  }
}

async function runJob(job) {
  job.status = "running";
  const dir = path.join(DATA, "audits", job.id);
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  emit(job, "started", { url: job.label, pack: job.pack });

  const browser = await chrome.launch();
  let rejectAt = null;
  const seen = [];
  const watcher = chrome.watch(browser.wsUrl, {
    fps: 4,
    onFrame: (data) => emit(job, "frame", { data }),
    onRequest: (r) => {
      let u;
      try { u = new URL(r.url); } catch { return; }
      if (/favicon\.ico$/.test(u.pathname)) return;
      const tracker = consent.matchDomain(u);
      const item = { method: r.method, url: (u.host + u.pathname).slice(0, 120), tracker: tracker || null, after: rejectAt != null && r.time >= rejectAt, t: r.time };
      seen.push(item);
      emit(job, "request", item);
    },
  });

  let res;
  try {
    res = await kane.run(liveObjective(job.pack, job.target.url), {
      maxSteps: Number(process.env.MAX_STEPS || 16),
      timeout: Number(process.env.RUN_TIMEOUT || 210),
      cdpEndpoint: browser.endpoint,
      username: process.env.LT_USERNAME,
      accessKey: process.env.LT_ACCESS_KEY,
      onEvent: (e) => {
        if (e.step && e.status && e.status !== "running") {
          const remark = String(e.remark || "");
          if (rejectAt == null && e.status === "done" && /^click\b/i.test(remark) && /(reject|decline|refuse|deny|necessary only|essential only)/i.test(remark)) {
            rejectAt = Date.now() - 1500;
            emit(job, "reject", { at: rejectAt, label: consent.cleanLabel(remark) });
          }
          emit(job, "step", { n: e.step, status: e.status, remark: remark.replace(/^(\w+):\s*/, (m, k) => `${k}: `) });
        }
      },
    });
  } finally {
    watcher.close();
    browser.close();
  }
  if (!res.end) throw new Error("Kane stopped without a result. " + (res.stderr || "").split("\n").filter(Boolean).slice(-2).join(" "));

  // Judge from Kane's sealed evidence pack; fall back to our own live capture
  // only if the pack has no network recording.
  let packPath = res.end.session_dir ? evidence.newestPack(res.end.session_dir) : null;
  if (packPath) {
    const copy = path.join(dir, "evidence", `${job.pack}-${Date.now()}.evidence`);
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
  const pk = PACKS[job.pack];
  const result = pk.judge({ end: res.end, events: res.events, network });
  fs.writeFileSync(path.join(dir, `${job.pack}.last-run.json`), JSON.stringify({ end: res.end, events: res.events, packPath }, null, 2));
  report.write(dir, pk, result, { evidence: packPath && path.basename(packPath), testUrl: res.end.test_url || network.shareLink, credits: res.end.credits_consumed, kaneStatus: res.end.status, kaneSummary: res.end.summary });
  page.build({ out: dir, packs: PACKS, url: job.label });
  job.result = result;
  job.caseUrl = `/audits/${job.id}/`;
  job.status = "done";
  emit(job, "verdict", { verdict: result.verdict, why: result.why, result, caseUrl: job.caseUrl, run: res.end.test_url || network.shareLink || null, credits: res.end.credits_consumed, source });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ url: job.label, pack: job.pack, result, caseUrl: job.caseUrl, events: job.events, lastFrame: job.lastFrame }));
  state.cache[job.key] = { id: job.id, at: Date.now() };
  save();
}

module.exports = { create, subscribe, status, loadFinished, jobs, DATA, PACKS };
