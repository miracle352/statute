// The live loop on the website: a fresh copy of a shop with Google's tag pasted in,
// Kane catches it, Claude Code fixes it, Kane proves the fix. Everything streams to
// the visitor as it happens. Only one job runs at a time (shared queue in audit.js).
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const audit = require("./audit");
const agent = require("../src/agent");
const page = require("../src/page");

const SRC = path.join(__dirname, "..", "examples", "lumen-tag");
const ROUNDS = 2;

const consentObjective = (url) =>
  `Go to ${url}. If a cookie or analytics consent banner is shown, click the button that rejects or declines it. ` +
  `If no banner is shown, do not look for one. Then open one page from the site's navigation, then reload that page.`;
const acceptObjective = (url) =>
  `Go to ${url}. In the cookie banner, click the button that accepts all cookies. Then open one page from the site's navigation.`;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function startShop(dir, port) {
  const child = spawn(process.execPath, ["server.js"], { cwd: dir, env: { ...process.env, PORT: String(port), BASE: "" }, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poke = () => http.get(url, (r) => { r.resume(); resolve({ child, url }); }).on("error", () => {
      if (Date.now() - t0 > 15000) { child.kill(); reject(new Error("The shop did not start.")); } else setTimeout(poke, 300);
    });
    poke();
  });
}

// Line diff for display: lines removed from and added to a file, in order.
function diffLines(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  const n = a.length, m = b.length;
  // LCS table; the files are small (a few hundred lines).
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push([" ", a[i]]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push(["+", b[j]]); j++; }
    else { out.push(["-", a[i]]); i++; }
  }
  // keep changed lines with one line of context
  const keep = new Set();
  out.forEach((l, k) => { if (l[0] !== " ") for (let d = -1; d <= 1; d++) keep.add(k + d); });
  const lines = [];
  let last = -2;
  out.forEach((l, k) => { if (!keep.has(k)) return; if (k > last + 1 && lines.length) lines.push(["@", "..."]); lines.push(l); last = k; });
  return lines.slice(0, 80);
}

function changedFiles(base, dir) {
  const files = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|\.claude|evidence|img)$/.test(e.name)) walk(r); continue; }
      if (!/\.(js|html|css|json)$/.test(e.name)) continue;
      const now = fs.readFileSync(path.join(dir, r), "utf8");
      const was = fs.existsSync(path.join(base, r)) ? fs.readFileSync(path.join(base, r), "utf8") : "";
      if (now !== was) files.push({ file: r.replace(/\\/g, "/"), lines: diffLines(was, now) });
    }
  })("");
  return files;
}

async function runLoop(job) {
  const { emit, observe, DATA, PACKS } = audit;
  job.status = "running";
  const dir = path.join(DATA, "audits", job.id);
  const app = path.join(dir, "app");
  copyDir(SRC, app);
  const port = 7900 + Math.floor(Math.random() * 90);
  let shop = await startShop(app, port);
  const url = shop.url;
  const timeline = [];
  let credits = 0;
  emit(job, "started", { url: "Lumen with Google's tag pasted in", pack: "loop" });
  emit(job, "phase", { phase: "change", text: "A fresh copy of the shop with Google's tag pasted into every page, as Google's setup page says." });

  try {
    for (let round = 1; round <= ROUNDS; round++) {
      emit(job, "phase", { phase: round === 1 ? "kane" : "prove", round, text: round === 1 ? "Kane opens the shop in a real Chrome, looks for a way to refuse cookies, and records every request." : "Kane checks Claude's fix in a fresh browser: Decline first." });
      const r = await observe(job, { url, objective: consentObjective(url), pack: "consent", dir, strict: true, phase: round === 1 ? "kane" : "prove" });
      credits += r.credits;
      timeline.push({ round, step: "kane", pack: "consent", verdict: r.result.verdict, why: r.result.why, run: r.run, evidence: r.packPath, credits: r.credits, at: new Date().toISOString() });
      emit(job, "judged", { round, pack: "consent", verdict: r.result.verdict, why: r.result.why, run: r.run, credits: r.credits });

      if (r.result.verdict === "pass") {
        emit(job, "phase", { phase: "prove", round, text: "Decline is clean. Now Accept, in another fresh browser: the tags must still load." });
        const g = await observe(job, { url, objective: acceptObjective(url), pack: "consent-accept", dir, strict: true, phase: "prove" });
        credits += g.credits;
        timeline.push({ round, step: "kane", pack: "consent-accept", verdict: g.result.verdict, why: g.result.why, run: g.run, evidence: g.packPath, credits: g.credits, at: new Date().toISOString() });
        emit(job, "judged", { round, pack: "consent-accept", verdict: g.result.verdict, why: g.result.why, run: g.run, credits: g.credits });
        if (g.result.verdict === "pass") return finish(true);
      } else if (r.result.verdict !== "violation") {
        return finish(false, "Kane's run could not prove anything either way, so the loop stopped instead of guessing.");
      }
      if (round === ROUNDS) break;

      // Hand Kane's report to Claude Code, exactly as the CLI and the GitHub Action do.
      emit(job, "phase", { phase: "claude", round, text: "Claude Code gets Statute's report and fixes the shop's source. Kane hasn't looked at the fix yet." });
      shop.child.kill();
      const reportMd = fs.readFileSync(path.join(dir, "consent.md"), "utf8").replace(/^﻿/, "");
      const t0 = Date.now();
      const summary = await withTimeout(agent.fix({ pack: PACKS.consent, reportMd, appDir: app, onLine: (line) => emit(job, "claude", { line: line.slice(0, 400) }) }), 300000, "Claude Code took longer than five minutes.");
      const files = changedFiles(SRC, app);
      timeline.push({ round, step: "agent", agent: "claude-code", summary, at: new Date().toISOString() });
      emit(job, "fixed", { round, summary: summary.slice(0, 1200), seconds: Math.round((Date.now() - t0) / 1000), files });
      shop = await startShop(app, port);
    }
    return finish(false, "Not fixed within two rounds. Nothing would have been pushed.");
  } finally {
    try { shop.child.kill(); } catch {}
  }

  function finish(fixed, note) {
    fs.writeFileSync(path.join(dir, "loop.json"), JSON.stringify({ title: "Live loop on statute-production.up.railway.app", pack: "consent", url, app: "app", strict: true, timeline, credits }, null, 2));
    try { page.build({ out: dir, packs: PACKS, url: "Lumen with Google's tag pasted in" }); } catch {}
    job.status = "done";
    job.caseUrl = `/audits/${job.id}/`;
    job.result = { verdict: fixed ? "pass" : "violation", why: note || "Kane found a violation, Claude Code fixed it, and Kane passed the fix after Decline and after Accept." };
    emit(job, "done", { fixed, note: job.result.why, credits: Math.round(credits * 10) / 10, caseUrl: job.caseUrl });
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ url: "live loop", pack: "loop", result: job.result, caseUrl: job.caseUrl, events: job.events, lastFrame: job.lastFrame }));
    audit.rememberLoop(job.id);
  }
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

module.exports = { runLoop, diffLines, changedFiles };
