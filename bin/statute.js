#!/usr/bin/env node
// Statute: laws that test themselves.
//
//   statute check consent --url <url> [--start "<cmd>"] [--show]
//   statute judge consent                       re-judge the last run, no credits
//   statute fix consent --url <url> --start "<cmd>" --app <dir> [--rounds 3]
//   statute report                              rebuild statute-report/index.html
//   statute reset-demo                          put the demo store's bugs back
const fs = require("fs");
const path = require("path");
const kane = require("../src/kane");
const evidence = require("../src/evidence");
const report = require("../src/report");
const app = require("../src/app");
const agent = require("../src/agent");
const page = require("../src/page");

const PACKS = {
  consent: require("../src/packs/consent"),
  "consent-accept": require("../src/packs/consent-accept"),
  cancel: require("../src/packs/cancel"),
};
const ROOT = path.resolve(__dirname, "..");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const when = { after: "after Reject", before: "before choice", unknown: "during visit" };
const firstLine = (s) => String(s || "").split("\n")[0];

// One Kane run of one pack, judged by code. Starts/stops the app if asked.
async function check(pack, { url, out, start, cwd, show }) {
  let child = null;
  if (start) {
    child = app.start(start, cwd);
    if (!(await app.waitUntilUp(url))) {
      app.stop(child);
      throw new Error(`the app did not come up at ${url} after "${start}"`);
    }
  } else if (!(await app.ping(url))) {
    throw new Error(`nothing is answering at ${url}; start the app or pass --start "<command>"`);
  }
  try {
    console.log(`\nStatute · ${pack.title}\nKane is visiting ${url}...`);
    const res = await kane.run(pack.objective(url), {
      headless: !show,
      maxSteps: Number(arg("max-steps", 25)),
      timeout: Number(arg("timeout", 300)),
      onEvent: (e) => { if (e.step && e.status && e.status !== "running") console.log(`  step ${e.step} ${e.status}: ${e.remark || ""}`); },
    });
    if (!res.end) throw new Error("Kane ended without a result.\n" + res.stderr.slice(-1500));
    let packPath = res.end.session_dir ? evidence.newestPack(res.end.session_dir) : null;
    fs.mkdirSync(path.join(out, "evidence"), { recursive: true });
    if (packPath) {
      const copy = path.join(out, "evidence", `${pack.id}-${Date.now()}.evidence`);
      fs.copyFileSync(packPath, copy);
      packPath = copy;
    }
    fs.writeFileSync(path.join(out, `${pack.id}.last-run.json`), JSON.stringify({ end: res.end, events: res.events, packPath }, null, 2));
    return judgeAndReport(pack, { end: res.end, events: res.events, packPath, out });
  } finally {
    app.stop(child);
  }
}

function judgeAndReport(pack, { end, events, packPath, out }) {
  if (!packPath) throw new Error("No evidence pack found.");
  const network = evidence.networkFromPack(packPath);
  const result = pack.judge({ end, events, network });
  const file = report.write(out, pack, result, {
    evidence: packPath,
    testUrl: (end && end.test_url) || network.shareLink,
    credits: end && end.credits_consumed,
    kaneStatus: end && end.status,
    kaneSummary: end && end.summary,
  });
  if (end && end.status === "failed") console.log(`Note: Kane's run ended early (${firstLine(end.summary)}); the verdict uses what it recorded up to that point.`);
  console.log(`\n${result.verdict.toUpperCase()}: ${result.why}`);
  for (const r of result.trackerRequests || []) console.log(`  · ${when[r.phase]}: ${r.tracker}  ${r.url}  ×${r.count}`);
  for (const i of result.idsAfterReject || []) console.log(`  · visitor ID sent after Reject: ${i}`);
  if (result.signup) {
    console.log(`  · subscribe (${result.signup.length}): ${result.signup.join(" → ")}`);
    console.log(`  · cancel (${result.cancel.length}): ${result.cancel.join(" → ") || "(nothing)"}`);
  }
  const credits = end && end.credits_consumed != null ? Number(end.credits_consumed) : 0;
  if (credits) console.log(`Credits used: ${credits.toFixed(1)}`);
  console.log(`Report: ${file}`);
  return { result, file, credits, packPath, kaneStatus: end && end.status, kaneSummary: end && end.summary, testUrl: (end && end.test_url) || network.shareLink };
}

// The closed loop: Kane finds it, the agent fixes it, Kane proves it.
async function fixLoop(pack, opts) {
  const rounds = Number(arg("rounds", 3));
  const timeline = [];
  let spent = 0;
  const log = path.join(opts.out, "loop.json");
  const save = () => fs.writeFileSync(log, JSON.stringify({ pack: pack.id, url: opts.url, app: opts.app, timeline, credits: spent }, null, 2));

  for (let round = 1; round <= rounds; round++) {
    const r = await check(pack, opts);
    spent += r.credits;
    timeline.push({ round, step: "kane", pack: pack.id, verdict: r.result.verdict, why: r.result.why, run: r.testUrl, evidence: r.packPath, credits: r.credits, kaneStatus: r.kaneStatus, kaneSummary: r.kaneSummary, at: new Date().toISOString() });
    save();
    if (r.result.verdict === "inconclusive") {
      console.log("\nKane's run could not prove anything either way, so the loop stops here instead of guessing.");
      break;
    }
    if (r.result.verdict === "pass") {
      // Guard against "fixed" by deleting analytics: Accept must still work.
      const guard = PACKS[`${pack.id}-accept`];
      if (guard) {
        const g = await check(guard, opts);
        spent += g.credits;
        timeline.push({ round, step: "kane", pack: guard.id, verdict: g.result.verdict, why: g.result.why, run: g.testUrl, evidence: g.packPath, credits: g.credits, kaneStatus: g.kaneStatus, kaneSummary: g.kaneSummary, at: new Date().toISOString() });
        save();
        if (g.result.verdict !== "pass") {
          if (round === rounds) break;
          await agentRound(guard, g.file, opts, timeline, round, save);
          continue;
        }
      }
      console.log(`\nDONE in ${round} round(s): Kane proved "${pack.title}" holds${guard ? " and Accept still works" : ""}. Credits used: ${spent.toFixed(1)}`);
      writeTimeline(opts.out, pack, timeline, spent, true);
      return 0;
    }
    if (round === rounds) break;
    await agentRound(pack, r.file, opts, timeline, round, save);
  }
  console.log(`\nNot fixed after ${rounds} round(s). Credits used: ${spent.toFixed(1)}. See ${path.join(opts.out, "loop.md")}`);
  writeTimeline(opts.out, pack, timeline, spent, false);
  return 1;
}

async function agentRound(pack, reportFile, opts, timeline, round, save) {
  console.log(`\nHanding the report to Claude Code (round ${round})...`);
  const summary = await agent.fix({
    pack,
    reportMd: fs.readFileSync(reportFile, "utf8"),
    appDir: opts.app,
    onLine: (l) => console.log("  claude │ " + l),
  });
  timeline.push({ round, step: "agent", agent: "claude-code", summary, at: new Date().toISOString() });
  save();
}

function writeTimeline(out, pack, timeline, spent, fixed) {
  const L = [`# ${fixed ? "FIXED" : "NOT FIXED"}: ${pack.title}`, ""];
  for (const t of timeline) {
    if (t.step === "kane") L.push(`- **Round ${t.round} · Kane · ${t.pack}: ${t.verdict.toUpperCase()}**. ${t.why}${t.run ? ` [Kane run](${t.run})` : ""}`);
    else L.push(`- **Round ${t.round} · Claude Code fixed the app:** ${t.summary.replace(/\n+/g, " ")}`);
  }
  L.push("", `Credits used: ${spent.toFixed(1)}`, "");
  fs.writeFileSync(path.join(out, "loop.md"), "\ufeff" + L.join("\n"));
  const html = page.build({ out, packs: PACKS });
  console.log(`Case file: ${html}`);
}

function resetDemo() {
  const src = path.join(ROOT, "demo-store", ".buggy");
  const dst = path.join(ROOT, "demo-store");
  const copy = (from, to) => {
    for (const f of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, f.name);
      const b = path.join(to, f.name);
      if (f.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.copyFileSync(a, b);
    }
  };
  copy(src, dst);
  console.log("Demo store reset: its compliance bugs are back.");
}

async function main() {
  const [cmd, packId] = process.argv.slice(2);
  if (cmd === "reset-demo") return resetDemo();
  if (cmd === "report") {
    const html = page.build({ out: path.resolve(arg("out", "statute-report")), packs: PACKS });
    console.log(`Case file: ${html}`);
    return;
  }
  const pack = PACKS[packId];
  const usage =
    "usage:\n" +
    "  statute check <pack> --url <url> [--start \"<cmd>\"] [--show]\n" +
    "  statute judge <pack>                     re-judge the last run, no credits\n" +
    "  statute fix <pack> --url <url> --start \"<cmd>\" --app <dir> [--rounds 3]\n" +
    "  statute report                           rebuild the case file (statute-report/index.html)\n" +
    "  statute reset-demo\n" +
    `packs: ${Object.keys(PACKS).join(", ")}`;
  if (!["check", "judge", "fix"].includes(cmd) || !pack) { console.error(usage); process.exit(2); }

  const out = path.resolve(arg("out", "statute-report"));
  fs.mkdirSync(out, { recursive: true });
  const start = arg("start") === true ? null : arg("start", null);
  const opts = { url: arg("url"), out, start, cwd: process.cwd(), show: !!arg("show", false), app: path.resolve(arg("app", ".")) };

  if (cmd === "judge") {
    const last = path.join(out, `${pack.id}.last-run.json`);
    let saved = fs.existsSync(last) ? JSON.parse(fs.readFileSync(last, "utf8")) : {};
    const ev = arg("evidence");
    if (ev && ev !== true) saved = { ...saved, packPath: ev };
    const r = judgeAndReport(pack, { ...saved, out });
    process.exit(r.result.verdict === "pass" ? 0 : r.result.verdict === "violation" ? 1 : 3);
  }
  if (!opts.url || opts.url === true) { console.error("--url is required\n\n" + usage); process.exit(2); }
  if (cmd === "check") {
    fs.rmSync(path.join(out, "loop.json"), { force: true });
    const r = await check(pack, opts);
    console.log(`Case file: ${page.build({ out, packs: PACKS })}`);
    process.exit(r.result.verdict === "pass" ? 0 : r.result.verdict === "violation" ? 1 : 3);
  }
  if (!start) { console.error("fix needs --start \"<command that runs your app>\" so Statute can restart it after each change"); process.exit(2); }
  fs.rmSync(path.join(out, "loop.json"), { force: true });
  process.exit(await fixLoop(pack, opts));
}

main().catch((e) => { console.error("\nStatute stopped: " + (e.message || e)); process.exit(3); });
