#!/usr/bin/env node
// Statute Census: runs the live "Reject means reject" audit on a list of sites,
// one at a time, and publishes only anonymised results.
//   node bin/census.js                 run every site not done yet (resumes)
//   node bin/census.js --only 3        run just the first 3 pending sites
//   node bin/census.js --summary       print the results so far
const fs = require("fs");
const path = require("path");
// Census runs get a tighter step budget than the public site: one page and a reload is enough.
process.env.MAX_STEPS = process.env.MAX_STEPS || "11";
const guard = require("../server/guard");
const audit = require("../server/audit");

const DIR = path.join(__dirname, "..", "census");
const SITES = path.join(DIR, "private", "sites.json");
const PRIVATE = path.join(DIR, "private", "results.json");
const PUBLIC = path.join(DIR, "results.json");

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i < 0 ? null : (process.argv[i + 1] || true); };
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

const ISO = { Germany: "DE", France: "FR", Netherlands: "NL", Spain: "ES", Italy: "IT", Poland: "PL", Sweden: "SE", Ireland: "IE", "United Kingdom": "GB", "United States": "US", India: "IN", Japan: "JP", Nigeria: "NG", "South Africa": "ZA", Argentina: "AR", Brazil: "BR", Australia: "AU" };
// With TestMu credentials set, each site is audited from a cloud browser in its own
// country, so it sees the banner a local visitor sees. --local runs from this machine.
const CLOUD = !!(process.env.LT_USERNAME && process.env.LT_ACCESS_KEY) && !process.argv.includes("--local");
const DEMONYM = { Germany: "German", France: "French", Netherlands: "Dutch", Spain: "Spanish", Italy: "Italian", Poland: "Polish", Sweden: "Swedish", Ireland: "Irish", "United Kingdom": "British", "United States": "American", India: "Indian", Japan: "Japanese", Nigeria: "Nigerian", "South Africa": "South African", Argentina: "Argentine", Brazil: "Brazilian", Australia: "Australian" };
const anon = (r) => { const a = `${DEMONYM[r.country] || r.country} ${r.category}`; return `${/^[aeiou]/i.test(a) ? "An" : "A"} ${a}`; };

function publish(done) {
  const rows = Object.values(done).map((r) => ({
    label: anon(r),
    country: r.country,
    category: r.category,
    verdict: r.verdict,
    bannerShown: r.bannerShown,
    blocked: !!r.blocked,
    afterReject: r.afterReject,
    beforeChoice: r.beforeChoice,
    visitorIds: r.visitorIds,
    repeatedIds: r.repeatedIds,
    cookieless: r.cookieless,
    trackers: r.trackers,
    credits: r.credits,
    fromOwnCountry: r.from && r.from !== "local",
  }));
  const judged = rows.filter((r) => r.verdict === "violation" || r.verdict === "pass");
  const summary = {
    generated: new Date().toISOString(),
    sites: rows.length,
    judged: judged.length,
    violations: rows.filter((r) => r.verdict === "violation").length,
    passed: rows.filter((r) => r.verdict === "pass").length,
    noBanner: rows.filter((r) => r.bannerShown === false).length,
    blocked: rows.filter((r) => r.blocked).length,
    notJudged: rows.filter((r) => r.verdict !== "violation" && r.verdict !== "pass").length,
    countries: [...new Set(rows.map((r) => r.country))].length,
    credits: Math.round(rows.reduce((a, r) => a + (r.credits || 0), 0)),
    fromOwnCountry: rows.filter((r) => r.fromOwnCountry).length,
    note: "Kane CLI visited each site once as a new visitor, from a TestMu AI cloud browser in the site's own country where available, refused cookies where a banner was shown, browsed one page and reloaded. Sites are anonymised. Evidence, not legal advice.",
  };
  fs.writeFileSync(PUBLIC, JSON.stringify({ summary, rows }, null, 2));
  fs.writeFileSync(path.join(__dirname, "..", "site", "assets", "census.json"), JSON.stringify({ summary, rows }));
  return summary;
}

async function main() {
  const sites = load(SITES, []);
  const done = load(PRIVATE, {});
  if (arg("summary")) { console.log(publish(done)); return; }
  if (arg("probe")) {
    // One cheap check that cloud browsers work before spending credits on the whole list.
    if (!CLOUD) { console.log("Set LT_USERNAME and LT_ACCESS_KEY first."); return; }
    const job = await audit.runDirect({ url: "https://example.com/", label: "probe", pack: "consent", country: "DE" });
    console.log(job.error ? "Cloud browser failed: " + job.error : `Cloud browser in Germany worked (Kane: ${job.kaneEnd && job.kaneEnd.status}).`);
    return;
  }
  // --redo re-runs sites that were not judged (e.g. after switching to in-country browsers).
  const redo = process.argv.includes("--redo");
  const pending = sites.filter((s) => !done[s.url] || done[s.url].verdict === "error" || (redo && done[s.url].verdict !== "violation" && done[s.url].verdict !== "pass" && done[s.url].from !== (CLOUD ? ISO[s.country] : "local")));
  if (!CLOUD) console.log("Running from this machine. Set LT_USERNAME and LT_ACCESS_KEY to audit each site from its own country.\n");
  const limit = arg("only") ? Number(arg("only")) : pending.length;
  console.log(`Statute Census: ${Object.keys(done).length} done, ${pending.length} to go, running ${Math.min(limit, pending.length)} now.\n`);
  let i = 0, errorsInRow = 0;
  for (const s of pending.slice(0, limit)) {
    if (errorsInRow >= 2) { console.log("\nTwo runs in a row failed before Kane started. Stopping so no more time is wasted; see the error above."); break; }
    i++;
    let url;
    try { url = await guard.check(s.url); } catch (e) { console.log(`skip ${s.url}: ${e.message}`); continue; }
    const label = `${s.country} ${s.category}`;
    process.stdout.write(`[${i}/${Math.min(limit, pending.length)}] ${label} ... `);
    const t0 = Date.now();
    const job = await audit.runDirect({ url, label: url.replace(/\/$/, ""), pack: "consent", country: CLOUD ? ISO[s.country] : undefined });
    const r = job.result;
    const after = r ? r.trackerRequests.filter((x) => x.phase === "after" && !x.consentDenied).reduce((a, x) => a + x.count, 0) : 0;
    const before = r ? r.trackerRequests.filter((x) => x.phase === "before" && !x.consentDenied).reduce((a, x) => a + x.count, 0) : 0;
    const credits = (job.events.find((e) => e.type === "verdict") || {}).credits || 0;
    const endText = String((job.kaneEnd && job.kaneEnd.summary) || (r && r.why) || job.error || "");
    const blocked = (!r || r.verdict !== "violation") && /\b403\b|\b502\b|blocked|access denied|captcha|bot protection|verify you are human/i.test(endText);
    done[s.url] = {
      ...s, at: new Date().toISOString(), audit: job.id, from: CLOUD ? ISO[s.country] : "local", verdict: r ? r.verdict : "error", why: r ? r.why : job.error,
      bannerShown: r ? r.bannerShown : null, blocked, afterReject: after, beforeChoice: before,
      visitorIds: r ? (r.idsAfterReject || []).length : 0,
      repeatedIds: r ? (r.why || "").includes("more than once") : false,
      cookieless: r ? r.cookielessPings || 0 : 0,
      trackers: r ? [...new Set(r.trackerRequests.filter((x) => !x.consentDenied).map((x) => x.tracker))] : [],
      credits: Number(credits) || 0,
    };
    fs.writeFileSync(PRIVATE, JSON.stringify(done, null, 2));
    errorsInRow = r ? 0 : errorsInRow + 1;
    if (!r) console.log("   " + String(job.error || "").slice(0, 400));
    const sum = publish(done);
    console.log(`${(r && r.verdict) || "error"} (${Math.round((Date.now() - t0) / 1000)}s, ${(Number(credits) || 0).toFixed(1)} credits)  running total: ${sum.violations} violations / ${sum.judged} judged`);
  }
  console.log("\n", publish(done));
}

main().catch((e) => { console.error(e); process.exit(1); });
