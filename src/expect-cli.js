// `statute expect`: run a Kane CLI test file (or take a sealed pack) and check
// its expectations against what Kane recorded. Optional --fix hands broken
// expectations to Claude Code and has Kane run the test again until they hold.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const packReader = require("./pack");
const expect = require("./expect");
const kane = require("./kane");
const app = require("./app");
const agent = require("./agent");

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ICON = { pass: "PASS", fail: "FAIL", unknown: "----" };
const creditsLine = (n) => (n > 0 ? ` Credits used: ${n.toFixed(1)}` : "");

// A sidecar in Kane's own verdict format (evidence-cli verdict.schema.json),
// next to the pack, like `kane-cli evidence verdict` writes its own.
function writeVerdict(packPath, rules, judged) {
  let run = {};
  try {
    const buf = fs.readFileSync(packPath);
    const zip = require("./zip");
    const e = zip.entries(buf).find((x) => x.name === "run.yaml");
    if (e) {
      const y = zip.read(buf, e).toString("utf8");
      run = { id: (y.match(/^id:\s*(\S+)/m) || y.match(/^run_id:\s*(\S+)/m) || [])[1] || null, contract: (y.match(/^evidence:\s*'?([^'\s]+)/m) || [])[1] || null };
    }
  } catch {}
  const gates = judged.results.map((r, i) => ({
    id: `expect-${i + 1}`,
    expr: r.rule,
    where: null,
    op: "expr",
    expected: true,
    actual: r.status === "unknown" ? null : r.status === "pass",
    severity: "blocking",
    status: r.status === "unknown" ? "errored" : r.status,
    trust: r.status === "unknown" ? null : "recomputed",
    message: r.detail,
    error: r.status === "unknown" ? { code: "statute.unresolved", message: r.detail, hint: null } : null,
    stored: null,
  }));
  const failed = gates.filter((g) => g.status === "fail").map((g) => g.id);
  const errored = gates.filter((g) => g.status === "errored").map((g) => g.id);
  const result = errored.length ? "errored" : failed.length ? "fail" : "pass";
  const doc = {
    result,
    evaluated_at: new Date().toISOString(),
    evaluator: `statute ${require("../package.json").version}`,
    pack: { run_id: run.id || null, sha256: sha256(fs.readFileSync(packPath)), contract: run.contract || null },
    policy: { id: "statute", sha256: sha256(rules.join("\n")) },
    catalog: null,
    error: null,
    gates,
    failed_gates: failed,
    warnings: [],
    errored_gates: errored,
    exit_code: result === "pass" ? 0 : result === "fail" ? 1 : 3,
  };
  const dir = `${packPath}.verdicts`;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "statute.verdict.json");
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

function reportMd(judged, { testName, packPath, kaneStatus, shareLink }) {
  const L = [];
  L.push(`## Statute: ${judged.verdict.toUpperCase()}${testName ? ` · ${testName}` : ""}`, "");
  L.push(`Kane's own result: ${kaneStatus || "unknown"} (that only says the steps ran). Statute checked what the page did, from Kane's sealed evidence${judged.site ? ` on ${judged.site}` : ""}:`, "");
  L.push("| | Expectation | What Kane recorded |", "|---|---|---|");
  for (const r of judged.results) L.push(`| ${ICON[r.status]} | ${r.rule.replace(/\|/g, "\\|")} | ${r.detail.replace(/\|/g, "\\|")} |`);
  L.push("");
  for (const r of judged.results.filter((x) => x.status === "fail" && x.evidence && x.evidence.length)) {
    L.push(`**${r.rule}**`, "");
    for (const e of r.evidence.slice(0, 8)) L.push(`- ${[e.time, e.method, e.status, e.host, e.how, e.url, e.text].filter(Boolean).join(" · ")}`);
    L.push("");
  }
  if (shareLink) L.push(`Kane run: ${shareLink}`, "");
  if (packPath) L.push(`Evidence pack: \`${packPath}\``, "");
  return L.join("\n");
}

// Content hashes of the app's files, to tell whether the agent really changed anything.
function fingerprint(dir) {
  const map = new Map();
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (/^(node_modules|\.git|statute-report|\.testmuai)$/.test(e.name) || /^output-/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 6) walk(p, depth + 1);
      else if (e.isFile()) { try { if (fs.statSync(p).size < 2e6) map.set(path.relative(dir, p), sha256(fs.readFileSync(p))); } catch {} }
    }
  };
  walk(dir, 0);
  return map;
}
const changedFiles = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

function newestPackSince(dir, since) {
  const found = [];
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4 && !e.name.endsWith(".verdicts")) walk(p, depth + 1);
      else if (e.name.endsWith(".evidence")) { const t = fs.statSync(p).mtimeMs; if (t >= since) found.push({ p, t }); }
    }
  };
  walk(dir, 0);
  found.sort((a, b) => b.t - a.t);
  return found.length ? found[0].p : null;
}

// kane-cli testmd run <file> --agent --url <url>: returns the NDJSON events and the sealed pack.
function runTest(file, { url, headless = true, maxSteps, timeout = 600, onEvent }) {
  const bin = kane.binary();
  const args = ["testmd", "run", file, "--agent", "--timeout", String(timeout)];
  if (url) {
    // {{url}} in the test file: Kane reads variables from a file (safe on every shell).
    const vf = path.join(require("os").tmpdir(), `statute-vars-${process.pid}.json`);
    fs.writeFileSync(vf, JSON.stringify({ url: { value: url } }));
    args.push("--url", url, "--variables-file", vf);
  }
  if (headless) args.push("--headless");
  if (maxSteps) args.push("--max-steps", String(maxSteps));
  if (process.env.LT_USERNAME && process.env.LT_ACCESS_KEY) args.push("--username", process.env.LT_USERNAME, "--access-key", process.env.LT_ACCESS_KEY);
  const started = Date.now() - 1000;
  const child = bin
    ? spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KANE_CLI_USER_AGENT: "statute" } })
    : spawn("kane-cli", args, { shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KANE_CLI_USER_AGENT: "statute" } });
  return kane.collect(child, onEvent, timeout).then((res) => {
    const packPath = newestPackSince(path.join(process.cwd(), ".testmuai"), started) || newestPackSince(path.dirname(path.resolve(file)), started);
    return { ...res, packPath };
  });
}

function judgePack(packPath, { rulesFile, testName, kaneStatus } = {}) {
  const pack = packReader.read(packPath);
  let rules = pack.expectations;
  if (rulesFile) rules = fs.readFileSync(rulesFile, "utf8").split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter((l) => l && !l.startsWith("#"));
  if (!rules.length) throw Object.assign(new Error("This test has no expectations. Add them to the test file:\n\n<!-- expect\n- no request to a tracker after \"<step heading>\"\n-->\n\nor pass --rules <file>. See: statute expect --help"), { code: 2 });
  const judged = expect.judge(pack, rules);
  const md = reportMd(judged, { testName: testName || (pack.testMd && (pack.testMd.match(/^#\s+(.+)$/m) || [])[1]), packPath, kaneStatus: kaneStatus || pack.kaneStatus, shareLink: pack.shareLink });
  const verdictFile = writeVerdict(packPath, rules, judged);
  return { judged, md, verdictFile, rules, pack };
}

function print(judged, verdictFile) {
  console.log("");
  for (const r of judged.results) console.log(`  ${ICON[r.status]}  ${r.rule}\n        ${r.detail}`);
  console.log(`\n${judged.verdict.toUpperCase()}: ${judged.why}`);
  if (judged.kaneStatus) console.log(`(Kane's own result for the same run: ${judged.kaneStatus}.)`);
  console.log(`Verdict file: ${verdictFile}`);
}

const HELP = `statute expect: check what the page did while Kane ran your test.

  statute expect <name>_test.md --url <url> [--start "<cmd>"] [--show]
  statute expect <name>_test.md --url <url> --start "<cmd>" --fix [--app <dir>] [--rounds 3]
  statute expect <pack.evidence> | --latest            judge a sealed pack again, no credits
  options: --rules <file>  --out <dir>  --json

Write expectations in the test file, in a comment Kane ignores:

  <!-- expect
  - no request to a tracker after "Refuse cookies"
  - what was typed in "Newsletter" never leaves this site
  -->

Rules Statute understands (steps are your "## headings"; after/before = after
or before the last thing Kane did in that step):

  no request to a tracker | a third party | <host>   [after|before|during "<step>"]
  no visitor ID sent to a tracker                    [after|before|during "<step>"]
  no tracker cookie                                  [after|before|during "<step>"]
  what was typed in "<step>" never leaves this site  (plain, URL-encoded, Base64 or SHA-256)
  text "<value>" never leaves this site
  value of $<kane_variable> never leaves this site
  no server errors | no failed requests to this site | no console errors
  value $<a> equals | is at most | is at least $<b> [plus $<c> | <number>]
  clicks in "<step>" at most clicks in "<step>" [plus <n>]

Exit codes: 0 every expectation held, 1 one broke, 3 could not be checked.
A verdict in Kane's own format is written next to the pack: <pack>.verdicts/statute.verdict.json`;

async function main(argv, { arg, latestPack, writableBase }) {
  const target = argv[0];
  if (!target || target === "--help" || target === "-h") { console.log(HELP); return 0; }
  const out = path.resolve(arg("out", path.join(writableBase(), "statute-report")));
  fs.mkdirSync(out, { recursive: true });
  const rulesFile = arg("rules") === true ? null : arg("rules", null);
  const finish = (r) => {
    fs.writeFileSync(path.join(out, "expect.md"), "﻿" + r.md);
    fs.writeFileSync(path.join(out, "expect.json"), JSON.stringify(r.judged, null, 2));
    if (arg("json")) console.log(JSON.stringify(r.judged, null, 2)); else print(r.judged, r.verdictFile);
    console.log(`Report: ${path.join(out, "expect.md")}`);
    return r.judged.verdict === "pass" ? 0 : r.judged.verdict === "violation" ? 1 : 3;
  };

  if (target === "--latest" || target.endsWith(".evidence")) {
    const p = target === "--latest" ? latestPack() : path.resolve(target);
    if (!p || !fs.existsSync(p)) { console.error("No sealed Kane evidence pack found. Run a Kane test first, or pass the .evidence file."); return 3; }
    console.log(`Checking ${p}`);
    return finish(judgePack(p, { rulesFile }));
  }

  if (!/_test\.md$/i.test(target) || !fs.existsSync(target)) { console.error(`Not a Kane test file: ${target} (expected <name>_test.md)\n\n${HELP}`); return 2; }
  const url = arg("url");
  if (!url || url === true) { console.error("--url is required to run the test"); return 2; }
  const start = arg("start") === true ? null : arg("start", null);
  const testText = fs.readFileSync(target, "utf8");
  if (!rulesFile && !packReader.expectations(testText).length) { console.error(`${target} has no expectations yet.\n\n${HELP}`); return 2; }
  if (!kane.available()) { console.error("Statute needs Kane CLI: npm install -g @testmuai/kane-cli, then kane-cli login"); return 3; }
  const testName = (testText.match(/^#\s+(.+)$/m) || [])[1] || path.basename(target);
  const fixing = !!arg("fix");
  const rounds = fixing ? Number(arg("rounds", 3)) : 1;
  const appDir = path.resolve(arg("app", "."));
  const timeline = [];
  let spent = 0;

  for (let round = 1; round <= rounds; round++) {
    let child = null;
    if (start) {
      child = app.start(start, process.cwd());
      if (!(await app.waitUntilUp(url))) { app.stop(child); console.error(`The app did not come up at ${url} after "${start}"`); return 3; }
    } else if (!(await app.ping(url))) { console.error(`Nothing is answering at ${url}; start the app or pass --start "<command>"`); return 3; }
    let res;
    try {
      console.log(`\nStatute · ${testName}${fixing ? ` · round ${round}` : ""}\nKane is running ${path.basename(target)} against ${url}...`);
      res = await runTest(target, {
        url, headless: !arg("show"), maxSteps: arg("max-steps") === true ? undefined : arg("max-steps"),
        onEvent: (e) => { if (e.step && e.status && e.status !== "running") console.log(`  step ${e.step} ${e.status}: ${e.remark || ""}`); },
      });
    } finally { app.stop(child); }
    if (!res.packPath) { console.error("Kane sealed no evidence pack.\n" + String(res.stderr || "").slice(-1200)); return 3; }
    // Keep a copy with the report, so the case file travels with its evidence.
    fs.mkdirSync(path.join(out, "evidence"), { recursive: true });
    const kept = path.join(out, "evidence", `${path.basename(target, ".md")}-round${round}-${Date.now()}.evidence`);
    fs.copyFileSync(res.packPath, kept);
    res.packPath = kept;
    const credits = Number((res.end && res.end.credits_consumed) || 0);
    spent += credits;
    const r = judgePack(res.packPath, { rulesFile, testName, kaneStatus: res.end && res.end.status });
    timeline.push({ round, step: "kane", verdict: r.judged.verdict, why: r.judged.why, kaneStatus: res.end && res.end.status, credits, evidence: res.packPath, results: r.judged.results, at: new Date().toISOString() });
    const code = finish(r);
    fs.writeFileSync(path.join(out, "expect-loop.json"), JSON.stringify({ test: testName, url, timeline, credits: spent }, null, 2));
    if (!fixing || code !== 1 || round === rounds) {
      const agentChanged = timeline.some((t) => t.step === "agent" && t.changed && t.changed.length);
      if (fixing) console.log(code === 0 ? `\n${agentChanged ? "FIXED and proven" : "PASSED"} in ${round} round(s).${creditsLine(spent)}` : `\nStopped after ${round} round(s): ${code === 1 ? "still broken" : "could not be checked"}.${creditsLine(spent)}`);
      return code;
    }
    console.log(`\nHanding the broken expectations to Claude Code (round ${round})...`);
    const before = fingerprint(appDir);
    let summary;
    try {
      summary = await agent.fix({ appDir, text: agent.promptExpect({ reportMd: r.md, appDir, testName }), onLine: (l) => console.log("  claude │ " + l) });
    } catch (e) {
      console.log(`\n${e.message}\nNOT FIXED: the expectations above are still broken. Nothing was changed.${creditsLine(spent)}`);
      timeline.push({ round, step: "agent", agent: "claude-code", error: e.message, at: new Date().toISOString() });
      fs.writeFileSync(path.join(out, "expect-loop.json"), JSON.stringify({ test: testName, url, timeline, credits: spent }, null, 2));
      return 1;
    }
    const changed = changedFiles(before, fingerprint(appDir));
    if (!changed.length) {
      console.log(`\nClaude Code answered but changed no file, so there is nothing for Kane to prove. NOT FIXED.${creditsLine(spent)}`);
      timeline.push({ round, step: "agent", agent: "claude-code", summary, changed, at: new Date().toISOString() });
      fs.writeFileSync(path.join(out, "expect-loop.json"), JSON.stringify({ test: testName, url, timeline, credits: spent }, null, 2));
      return 1;
    }
    console.log(`  Claude Code changed ${changed.join(", ")}`);
    timeline.push({ round, step: "agent", agent: "claude-code", summary, changed, at: new Date().toISOString() });
  }
  return 1;
}

module.exports = { main, judgePack, writeVerdict, reportMd, runTest, HELP };
