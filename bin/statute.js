#!/usr/bin/env node
// statute check consent --url http://localhost:4173 [--show] [--out statute-report]
// statute judge consent --evidence <file.evidence>   (re-judge a saved run, no credits)
const path = require("path");
const kane = require("../src/kane");
const evidence = require("../src/evidence");
const report = require("../src/report");

const PACKS = { consent: require("../src/packs/consent") };

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const [cmd, packId] = process.argv.slice(2);
  const pack = PACKS[packId];
  if (!["check", "judge"].includes(cmd) || !pack) {
    console.error("usage: statute check consent --url <url> [--show]\n       statute judge consent --evidence <file>");
    process.exit(2);
  }
  const out = path.resolve(arg("out", "statute-report"));

  let end = null;
  let packPath = arg("evidence");
  if (cmd === "check") {
    const url = arg("url");
    if (!url || url === true) { console.error("--url is required"); process.exit(2); }
    console.log(`Statute · ${pack.title}\nKane is visiting ${url} as someone who refuses cookies...`);
    const res = await kane.run(pack.objective(url), {
      headless: !arg("show", false),
      maxSteps: Number(arg("max-steps", 25)),
      timeout: Number(arg("timeout", 300)),
      onEvent: (e) => { if (e.step && e.status && e.status !== "running") console.log(`  step ${e.step} ${e.status}: ${e.remark || ""}`); },
    });
    end = res.end;
    if (!end) {
      console.error("Kane ended without a result.\n" + res.stderr.slice(-2000));
      process.exit(3);
    }
    packPath = end.session_dir ? evidence.newestPack(end.session_dir) : null;
  }
  if (!packPath) { console.error("No evidence pack found."); process.exit(3); }

  const network = evidence.networkFromPack(packPath);
  const result = pack.judge({ end, network });
  const file = report.write(out, pack, result, {
    evidence: packPath,
    testUrl: end && end.test_url,
    credits: end && end.credits_consumed,
    kaneStatus: end && end.status,
  });
  console.log(`\n${result.verdict.toUpperCase()}: ${result.why}`);
  for (const r of result.trackerRequests) console.log(`  · ${r.tracker}  ${r.url}`);
  if (result.trackerCookies.length) console.log(`  · cookies: ${result.trackerCookies.join(", ")}`);
  if (end && end.credits_consumed != null) console.log(`Credits used: ${end.credits_consumed}`);
  console.log(`Report: ${file}`);
  process.exit(result.verdict === "pass" ? 0 : result.verdict === "violation" ? 1 : 3);
}

main().catch((e) => { console.error(e.stack || e); process.exit(3); });
