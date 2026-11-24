// Judge any Kane evidence pack against expectations, on the server, with code.
// The pack is read in memory and dropped; nothing is stored or logged.
const path = require("path");
const pack = require("../src/pack");
const expect = require("../src/expect");
const { view } = require("../src/expect-view");

const MAX_BYTES = 30 * 1024 * 1024;
const PER_HOUR = 60;
const SAMPLES = {
  before: path.join(__dirname, "..", "replays", "newsletter-expect", "evidence", "newsletter_test-round1-1795518837738.evidence"),
  after: path.join(__dirname, "..", "replays", "newsletter-expect", "evidence", "newsletter_test-round2-1795519079029.evidence"),
};
const DEFAULT_RULES = ["no server errors", "no failed requests to this site", "no console errors"];

const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= PER_HOUR) return false;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on("data", (d) => {
      n += d.length;
      if (n > limit) { reject(Object.assign(new Error("That pack is larger than 30 MB."), { code: 413 })); req.destroy(); return; }
      parts.push(d);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function cleanRules(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map((l) => String(l).replace(/^\s*[-*]\s+/, "").trim().slice(0, 300)).filter(Boolean).slice(0, 25);
  return out.length ? out : null;
}

async function handle(req, res, { sendJson, ip }) {
  if (!allowed(ip)) return sendJson(res, 429, { error: "That's 60 judgements in an hour from your address. Try again in a while, or run it locally: npx github:miracle352/statute expect <pack>." });
  let p, rules, source;
  try {
    const type = String(req.headers["content-type"] || "");
    if (type.startsWith("application/json")) {
      const body = JSON.parse((await readRaw(req, 64 * 1024)).toString("utf8") || "{}");
      const file = SAMPLES[body.sample];
      if (!file) return sendJson(res, 400, { error: "Unknown sample. Use \"before\" or \"after\"." });
      p = pack.read(file);
      rules = cleanRules(body.rules);
      source = body.sample === "before" ? "Recorded run, before the fix" : "Recorded run, after the fix";
    } else {
      const buf = await readRaw(req, MAX_BYTES);
      if (buf.length < 22) return sendJson(res, 400, { error: "Drop a .evidence file from .testmuai/evidence/." });
      try { p = pack.readBuffer(buf); } catch { return sendJson(res, 400, { error: "That isn't a Kane evidence pack. Use a .evidence file from .testmuai/evidence/ (or the -<n>.evidence copy Statute saves)." }); }
      if (!p.actions.length && !p.requests.length) return sendJson(res, 400, { error: "That pack has no action or network logs, so there is nothing to judge." });
      let raw = null;
      try { raw = JSON.parse(decodeURIComponent(String(req.headers["x-statute-rules"] || ""))); } catch {}
      rules = cleanRules(raw);
      source = "Your pack";
    }
  } catch (e) {
    return sendJson(res, e.code || 400, { error: e.code ? e.message : "Couldn't read that request." });
  }
  const own = p.expectations.length ? p.expectations : null;
  const used = rules || own || DEFAULT_RULES;
  const judged = expect.judge(p, used);
  sendJson(res, 200, {
    source,
    test: { title: (String(p.testMd || "").match(/^#\s+(.+)$/m) || [])[1] || null, steps: p.titles },
    rules: used,
    rulesFrom: rules ? "edited" : own ? "test" : "default",
    kaneStatus: judged.kaneStatus,
    verdict: judged.verdict,
    why: judged.why,
    results: judged.results.map((r) => ({ rule: r.rule, status: r.status, detail: r.detail })),
    view: view(p, judged),
  });
}

module.exports = { handle };
