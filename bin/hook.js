#!/usr/bin/env node
// Statute as a Claude Code Stop hook. When Claude Code is about to finish, Kane
// CLI checks the app; on a violation the hook blocks the stop and hands Claude
// the evidence, so it keeps fixing until Kane passes (or the round limit).
//
// .claude/settings.json in your project:
//   { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "timeout": 600,
//       "command": "npx -y @miracle352/statute hook" } ] } ] } }
//
// statute.json in your project says what to check:
//   { "check": "consent", "url": "http://localhost:3000/", "start": "npm run dev", "rounds": 3 }
// and, optionally, Kane test files whose expectations must hold:
//   "tests": ["tests/kane/newsletter_test.md"]
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd || process.cwd();
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(cwd, "statute.json"), "utf8")); } catch { process.exit(0); } // not set up here: stay out of the way
  const tests = [].concat(cfg.tests || []);
  const checks = [].concat(cfg.check || (tests.length ? [] : "consent"));
  const rounds = Number(cfg.rounds || 3);

  // Count rounds per session so a fix that never passes cannot loop forever.
  const state = path.join(os.tmpdir(), `statute-hook-${String(input.session_id || "local").replace(/[^\w-]/g, "")}.json`);
  let n = 0;
  try { n = JSON.parse(fs.readFileSync(state, "utf8")).n || 0; } catch {}
  if (!input.stop_hook_active) n = 0;
  if (n >= rounds) {
    fs.rmSync(state, { force: true });
    process.stderr.write(`Statute: still failing after ${rounds} rounds; letting Claude stop. See the last report.\n`);
    process.exit(0);
  }

  const failures = [];
  for (const check of checks) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "statute-hook-"));
    const args = [path.join(ROOT, "bin", "statute.js"), "check", check, "--url", cfg.url, "--out", out];
    if (cfg.start) args.push("--start", cfg.start);
    const r = spawnSync(process.execPath, args, { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stderr.write(r.stdout || "");
    if (r.status === 1) {
      let report = "";
      try { report = fs.readFileSync(path.join(out, `${check}.md`), "utf8").replace(/^﻿/, ""); } catch {}
      failures.push(report || `The ${check} check found a violation.`);
    }
  }

  for (const t of tests) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "statute-hook-"));
    const args = [path.join(ROOT, "bin", "statute.js"), "expect", t, "--url", cfg.url, "--out", out];
    if (cfg.start) args.push("--start", cfg.start);
    const r = spawnSync(process.execPath, args, { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stderr.write(r.stdout || "");
    if (r.status === 1) {
      let report = "";
      try { report = fs.readFileSync(path.join(out, "expect.md"), "utf8").replace(/^\uFEFF/, ""); } catch {}
      failures.push(report || `The Kane test ${t} broke its expectations.`);
    }
  }

  if (!failures.length) { fs.rmSync(state, { force: true }); process.exit(0); }
  fs.writeFileSync(state, JSON.stringify({ n: n + 1 }));
  const reason =
    `Statute (Kane CLI) checked ${cfg.url} in a real browser and found a violation or a broken expectation (round ${n + 1} of ${rounds}). ` +
    `Fix it in the code, then finish again; Kane will re-check.\n\n` + failures.join("\n\n---\n\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

main();
