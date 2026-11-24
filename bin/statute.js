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
  price: require("../src/packs/price"),
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
      // CI and servers sign in with keys from the environment; locally, kane-cli login is used.
      username: process.env.LT_USERNAME || undefined,
      accessKey: process.env.LT_ACCESS_KEY || undefined,
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
  const result = pack.judge({ end, events, network, strict: true });
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
  const save = () => fs.writeFileSync(log, JSON.stringify({ pack: pack.id, url: opts.url, app: path.relative(ROOT, opts.app) || ".", strict: true, timeline, credits: spent }, null, 2));

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
  const changed = timeline.some((t) => t.step === "agent");
  const head = fixed ? (changed ? "FIXED" : "PASSED") : (changed ? "NOT FIXED" : "VIOLATION");
  const note = fixed && !changed ? "Kane found nothing to fix, so Claude Code was not called." : fixed ? "Kane found a violation, Claude Code fixed it, and Kane passed the fix." : "";
  const L = [`### ${head}: ${pack.title}`, ""];
  if (note) L.push(note, "");
  for (const t of timeline) {
    if (t.step === "kane") L.push(`- **Round ${t.round} · Kane · ${t.pack}: ${t.verdict.toUpperCase()}**. ${t.why}${t.run ? ` [Kane run](${t.run})` : ""}`);
    else L.push(`- **Round ${t.round} · Claude Code fixed the app:** ${t.summary.replace(/\n+/g, " ")}`);
  }
  L.push("", `Credits used: ${spent.toFixed(1)}`, "");
  fs.writeFileSync(path.join(out, "loop.md"), "\ufeff" + L.join("\n"));
  const html = page.build({ out, packs: PACKS });
  console.log(`Case file: ${html}`);
}

// Zero-credit demo: re-judge recorded Kane runs from their sealed evidence packs
// and rebuild each case file. Nothing is sent to Kane.
function replay(only) {
  const base = path.join(ROOT, "replays");
  if (!fs.existsSync(base)) { console.error("This copy of Statute has no recorded runs (replays/). Get them with: git clone https://github.com/miracle352/statute"); process.exit(1); }
  const names = fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, "loop.json")) && (!only || n === only));
  if (!names.length) { console.error("No recorded runs found in replays/."); process.exit(1); }
  for (const name of names) {
    const src = path.join(base, name);
    const out = path.join(writableBase(), "statute-report", "replay", name);
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(path.join(src, "loop.json"), path.join(out, "loop.json"));
    fs.cpSync(path.join(src, "evidence"), path.join(out, "evidence"), { recursive: true });
    const loop = JSON.parse(fs.readFileSync(path.join(src, "loop.json"), "utf8"));
    console.log(`\n${loop.title || name}`);
    if (loop.pack === "expect") { replayExpect(src, loop, out); continue; }
    for (const t of loop.timeline) {
      if (t.step === "agent") { console.log(`  round ${t.round}  Claude Code changed the app`); continue; }
      const pk = PACKS[t.pack];
      const dir = path.join(src, "evidence");
      const f = String(t.evidence || "").split(/[\\/]/).pop();
      if (!f || !pk || !fs.existsSync(path.join(dir, f))) continue;
      const network = evidence.networkFromPack(path.join(dir, f));
      const r = pk.judge({ end: null, events: [], network, strict: !!loop.strict });
      console.log(`  round ${t.round}  ${pk.title.padEnd(26)} ${r.verdict.toUpperCase().padEnd(12)} ${r.why}`);
    }
    page.build({ out, packs: PACKS, url: loop.url });
    console.log(`  case file: ${path.join(out, "index.html")}`);
  }
  console.log("\nNo Kane runs and no credits: every verdict above was recomputed from the sealed evidence packs in replays/.");
}

// Expectation runs: re-judge each round's pack against the expectations in its own test.md.
function replayExpect(src, loop, out) {
  const pack = require("../src/pack");
  const expect = require("../src/expect");
  const cli = require("../src/expect-cli");
  for (const t of loop.timeline) {
    if (t.step === "agent") { console.log(`  round ${t.round}  Claude Code changed ${(t.changed || []).join(", ") || "the app"}`); continue; }
    const f = String(t.evidence || "").split(/[\\/]/).pop();
    const file = path.join(out, "evidence", f);
    if (!f || !fs.existsSync(file)) continue;
    const p = pack.read(file);
    const r = expect.judge(p, p.expectations);
    console.log(`  round ${t.round}  Kane: ${String(r.kaneStatus).padEnd(8)} Statute: ${r.verdict.toUpperCase().padEnd(12)} ${r.why}`);
    cli.writeVerdict(file, p.expectations, r);
  }
  console.log(`  verdicts: ${path.join(out, "evidence")} (*.verdicts/statute.verdict.json)`);
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

// Copies the Statute agent skill where Claude Code finds it (user-wide, or this project with --project).
function installSkill() {
  const os = require("os");
  const src = path.join(ROOT, "skill", "statute", "SKILL.md");
  const base = process.argv.includes("--project") ? path.join(process.cwd(), ".claude") : path.join(os.homedir(), ".claude");
  const dest = path.join(base, "skills", "statute", "SKILL.md");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Installed the Statute skill for Claude Code: ${dest}`);
  console.log("Claude Code now runs Statute after changes to tracking, prices or subscriptions, and isn't done until Kane passes.");
  console.log("Codex or Gemini CLI: point AGENTS.md or GEMINI.md at the same file.");
}

// Newest sealed Kane pack: a project's .testmuai folder first, then Kane's own sessions.
function latestPack() {
  const os = require("os");
  const roots = [path.join(process.cwd(), ".testmuai"), path.join(os.homedir(), ".testmuai", "kaneai", "sessions")];
  const found = [];
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 5) walk(p, depth + 1);
      else if (e.name.endsWith(".evidence")) { try { found.push({ p, t: fs.statSync(p).mtimeMs }); } catch {} }
    }
  };
  for (const r of roots) walk(r, 0);
  found.sort((a, b) => b.t - a.t);
  return found.length ? found[0].p : null;
}

// The current folder, unless the user can't write there (for example a shell opened in C:\Windows\System32).
let _base;
function writableBase() {
  if (_base) return _base;
  const os = require("os");
  for (const dir of [process.cwd(), os.homedir(), os.tmpdir()]) {
    try { fs.mkdirSync(path.join(dir, "statute-report"), { recursive: true }); fs.accessSync(path.join(dir, "statute-report"), fs.constants.W_OK); return (_base = dir); } catch {}
  }
  return (_base = os.tmpdir());
}

const HELP = `Statute: Kane CLI checks your app against consumer law in a real browser.
Code, not a model, decides the verdict. Run any command with npx github:miracle352/statute <command>

  demo                            see it work: re-judge recorded Kane runs (no account, no credits)
  check consent --url <url>       Kane clicks Reject on the cookie banner; Statute reports what still tracked
  check price   --url <url>       is the price shown the price paid at checkout?
  check cancel  --url <url>       is cancelling as easy as subscribing?
  fix <check> --url <url> --start "<cmd>" --app <dir>
                                  Kane finds it, Claude Code fixes it, Kane proves the fix
  init [--fix] [--live <url>]     add the GitHub workflows: every pull request, and production every night
  judge <check> --latest          judge the newest sealed Kane pack (for example after kane-cli testmd run laws/...)
  expect <name>_test.md --url <u> run any Kane test and check what the page did: requests, data leaving
                                  the site, cookies, errors, numbers (rules in the test file; --fix to repair)
  skill [--project]               install the agent skill: Claude Code runs Statute after risky changes
  hook                            Claude Code Stop hook: no "done" until Kane passes
  mcp                             MCP server: gives any agent a statute_check tool

Checks need Kane CLI: npm install -g @testmuai/kane-cli, then kane-cli login
(or set LT_USERNAME and LT_ACCESS_KEY). Docs: https://github.com/miracle352/statute`;

async function main() {
  const [cmd, packId] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); return; }
  if (cmd === "--version" || cmd === "-v") { console.log(require("../package.json").version); return; }
  if (cmd === "init") return require("./init.js")();
  if (cmd === "skill") return installSkill();
  if (cmd === "demo") return replay(packId);
  if (cmd === "reset-demo") return resetDemo();
  if (cmd === "mcp") return require("./mcp.js");
  if (cmd === "hook") return require("./hook.js");
  if (cmd === "replay") return replay(packId);
  if (cmd === "expect") process.exit(await require("../src/expect-cli").main(process.argv.slice(3), { arg, latestPack, writableBase }));
  if (cmd === "report") {
    const html = page.build({ out: path.resolve(arg("out", "statute-report")), packs: PACKS });
    console.log(`Case file: ${html}`);
    return;
  }
  const pack = PACKS[packId];
  const usage =
    "usage:\n" +
    "  statute check <pack> --url <url> [--start \"<cmd>\"] [--show]\n" +
    "  statute judge <pack> [--latest | --evidence <file>]   judge a sealed Kane pack, no credits\n" +
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
    const positional = process.argv.slice(4).find((a) => a.endsWith(".evidence"));
    if (ev && ev !== true) saved = { ...saved, packPath: ev };
    else if (positional) saved = { ...saved, packPath: positional };
    else if (arg("latest")) {
      const found = latestPack();
      if (!found) { console.error("No sealed Kane evidence pack found in .testmuai/evidence/ or your Kane sessions folder. Run a Kane test first, or pass --evidence <file>."); process.exit(3); }
      console.log(`Judging ${found}`);
      saved = { packPath: found };
    }
    const r = judgeAndReport(pack, { ...saved, out });
    process.exit(r.result.verdict === "pass" ? 0 : r.result.verdict === "violation" ? 1 : 3);
  }
  if (!opts.url || opts.url === true) { console.error("--url is required\n\n" + usage); process.exit(2); }
  if (!kane.available()) {
    console.error("Statute needs Kane CLI to visit the site.\n  npm install -g @testmuai/kane-cli\n  kane-cli login        (or set LT_USERNAME and LT_ACCESS_KEY)\n\nNo account yet? Free credits: https://www.testmuai.com/kane-cli/\nTo see Statute work without Kane: npx github:miracle352/statute demo");
    process.exit(3);
  }
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
