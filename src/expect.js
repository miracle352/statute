// Expectations: what a page must and must not do while Kane uses it, checked
// against Kane's sealed evidence by plain code. Kane's own verdict says the
// steps ran; these rules say what the page did underneath (requests, cookies,
// data leaving the site, errors, numbers, effort).
//
// Write them in the test file's frontmatter, one per line:
//
//   expect:
//     - no request to a tracker after "Refuse cookies"
//     - no visitor ID sent to a tracker after "Refuse cookies"
//     - no tracker cookie after "Refuse cookies"
//     - what was typed in "Sign up" never leaves this site
//     - text "jane@example.com" never leaves this site
//     - value of $email never leaves this site
//     - no request to google-analytics.com
//     - no request to a third party before "Accept"
//     - no server errors
//     - no failed requests to this site
//     - no console errors
//     - value $checkout_total is at most $product_price plus $shipping
//     - clicks in "Cancel" at most clicks in "Subscribe" plus 1
//
// Steps are named by their "## heading" in the test file. "after" and
// "before" mean after or before the last thing Kane did in that step.
const crypto = require("crypto");
const consent = require("./packs/consent");
const trackers = require("../rules/trackers.json");

const cookieRes = trackers.cookies.map((c) => new RegExp(c));
const isTrackerCookie = (n) => cookieRes.some((r) => r.test(n));
const STEP = `"([^"]+)"`;
const WHEN = `(?:\\s+(after|before|during)\\s+${STEP})?`;

// ---------- the grammar ----------
// Each rule: a pattern and a function that judges it against the pack.
const RULES = [
  { re: new RegExp(`^no request to (.+?)${WHEN}$`, "i"), kind: "request" },
  { re: new RegExp(`^no visitor id sent to (?:a )?trackers?${WHEN}$`, "i"), kind: "visitorId" },
  { re: new RegExp(`^no tracker cookies?${WHEN}$`, "i"), kind: "cookie" },
  { re: new RegExp(`^what was typed in ${STEP} never leaves this site$`, "i"), kind: "typed" },
  { re: new RegExp(`^text ${STEP} never leaves this site$`, "i"), kind: "text" },
  { re: /^value of \$([a-z_][\w]*) never leaves this site$/i, kind: "variable" },
  { re: /^no server errors$/i, kind: "server" },
  { re: /^no failed requests to this site$/i, kind: "failed" },
  { re: /^no console errors$/i, kind: "console" },
  { re: /^value \$([a-z_]\w*) (equals|is at most|is at least) (\$[a-z_]\w*|-?\d+(?:\.\d+)?)(?: plus (\$[a-z_]\w*|\d+(?:\.\d+)?))?$/i, kind: "compare" },
  { re: new RegExp(`^clicks in ${STEP} at most clicks in ${STEP}(?: plus (\\d+))?$`, "i"), kind: "clicks" },
];

function parse(line) {
  const s = String(line).trim().replace(/\s+/g, " ").replace(/[“”]/g, '"');
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) return { text: s, kind: r.kind, m };
  }
  return { text: s, kind: "unknown", m: null };
}

// ---------- helpers over the pack ----------
// Registrable-ish domain: "a.b.example.co.uk" -> "example.co.uk"; localhost stays.
function site(host) {
  const h = String(host || "").toLowerCase();
  if (!h.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  const p = h.split(".");
  const two = p.slice(-2).join(".");
  // Shared hosting suffixes: each app on them is its own site.
  if (p.length > 2 && (/^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) || /^(up\.railway\.app|railway\.app|vercel\.app|netlify\.app|github\.io|herokuapp\.com|onrender\.com|pages\.dev|workers\.dev|fly\.dev|web\.app|firebaseapp\.com|azurewebsites\.net|glitch\.me)$/.test(p.slice(-3).join(".")) || /^(railway\.app|vercel\.app|netlify\.app|github\.io|herokuapp\.com|onrender\.com|pages\.dev|workers\.dev|fly\.dev|web\.app|firebaseapp\.com|azurewebsites\.net|glitch\.me)$/.test(two))) {
    const sfx = /^up\.railway\.app$/.test(p.slice(-3).join(".")) ? 3 : 2;
    return p.slice(-(sfx + 1)).join(".");
  }
  return two;
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

// The site under test: the first page Kane opened.
function homeSite(pack) {
  for (const a of pack.actions) {
    const u = a.params && a.params.url;
    if (a.type === "navigate" && u && /^https?:/.test(u)) return site(hostOf(u));
  }
  for (const r of pack.requests) {
    let u;
    try { u = new URL(r.url); } catch { continue; }
    if (/^https?:$/.test(u.protocol) && !consent.matchDomain(u)) return site(u.hostname);
  }
  return null;
}

// A step by its heading; falls back to Kane's own action descriptions for
// single runs that have no test file.
function findStep(pack, name) {
  const want = name.toLowerCase();
  const sec = pack.sections.find((s) => s.title.toLowerCase() === want) || pack.sections.find((s) => s.title.toLowerCase().includes(want));
  if (sec && sec.actions.length) {
    const times = sec.actions.map((a) => a.time).filter(Boolean);
    return { label: sec.title, section: sec, start: Math.min(...times), end: Math.max(...times) };
  }
  if (sec) return { label: sec.title, section: sec, start: null, end: null };
  const a = pack.actions.find((x) => `${x.instruction} ${x.intent}`.toLowerCase().includes(want));
  if (a) return { label: a.instruction, section: null, start: a.time, end: a.time };
  return null;
}

// Requests inside a time window given by "after/before/during <step>".
function windowed(pack, items, when, stepName) {
  if (!when) return { items, scope: "during the whole run" };
  const step = findStep(pack, stepName);
  if (!step) return { error: `there is no step called "${stepName}" in this run` };
  if (when.toLowerCase() === "during") {
    const inSec = step.section ? items.filter((x) => x.section === step.section.index) : items.filter((x) => x.time >= step.start && x.time <= step.end);
    return { items: inSec, scope: `during "${step.label}"` };
  }
  if (step.end == null) return { error: `Kane recorded no actions in "${step.label}", so there is no moment to measure from` };
  const after = when.toLowerCase() === "after";
  return { items: items.filter((x) => x.time != null && (after ? x.time > step.end : x.time < step.end)), scope: `${after ? "after" : "before"} "${step.label}"` };
}

// Same counting as the consent law: Consent Mode "denied" pings and the bare
// Tag Manager library carry no measurement, so they are listed, not counted.
function trackerHit(r) {
  let u;
  try { u = new URL(r.url); } catch { return null; }
  const tracker = consent.matchDomain(u);
  if (!tracker) return null;
  const denied = consent.consentModeDenied(u);
  const loader = /(^|\.)googletagmanager\.com$/.test(u.hostname) && /^\/(gtm\.js|gtag\/js|gtag\/destination)$/.test(u.pathname);
  return { tracker, url: u, counted: !denied && !loader };
}

const short = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return String(u).slice(0, 80); } };
const sample = (list, f, n = 3) => list.slice(0, n).map(f);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// How a value can appear in a request: as is, URL-encoded, Base64, or hashed
// (ad pixels send SHA-256 of a lower-cased email as "advanced matching").
function forms(value) {
  const v = String(value).trim();
  if (v.length < 4) return [];
  const norm = v.toLowerCase();
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const out = [
    { how: "as typed", needle: norm },
    { how: "URL-encoded", needle: encodeURIComponent(v).toLowerCase() },
    { how: "Base64", needle: Buffer.from(v).toString("base64").toLowerCase() },
    { how: "SHA-256 hashed", needle: sha(norm) },
  ];
  if (norm !== v) out.push({ how: "SHA-256 hashed", needle: sha(v) });
  return out.filter((f, i, a) => a.findIndex((g) => g.needle === f.needle) === i);
}

function leaks(pack, values) {
  const home = homeSite(pack);
  const found = [];
  for (const r of pack.requests) {
    const host = hostOf(r.url);
    if (!host || site(host) === home) continue;
    let hay = `${r.url} ${r.body || ""}`.toLowerCase();
    try { hay += " " + decodeURIComponent(r.url).toLowerCase(); } catch {}
    for (const v of values) {
      const hit = forms(v).find((f) => hay.includes(f.needle));
      if (hit) { found.push({ host, url: short(r.url), time: r.iso, how: hit.how, value: v }); break; }
    }
  }
  return { home, found };
}

// What Kane typed: the value in the action's parameters, or the quoted text
// in its own description ("Typing "jane@x.com" into Email").
function typedValues(actions) {
  const out = [];
  for (const a of actions) {
    if (!/type|fill|input|enter|press_sequentially/i.test(a.type || "")) continue;
    const p = a.params || {};
    const v = p.value ?? p.text ?? p.input ?? p.content ?? p.keys;
    if (typeof v === "string" && v.trim() && !/^\{\{.*\}\}$/.test(v.trim())) { out.push(v); continue; }
    const q = String(a.instruction).match(/"([^"]{4,})"|'([^']{4,})'/);
    if (q) out.push(q[1] || q[2]);
  }
  return [...new Set(out)];
}

function variables(pack) {
  const v = {};
  for (const a of pack.actions) {
    if (!a.variable || a.value == null || a.status === "failed") continue;
    v[String(a.variable).toLowerCase()] = a.value;
  }
  return v;
}

// "€1.234,50" / "$1,234.50" / "49" -> number
function money(s) {
  const m = String(s ?? "").replace(/ /g, " ").match(/-?\d[\d.,\s]*/);
  if (!m) return null;
  let x = m[0].replace(/\s/g, "");
  const c = x.lastIndexOf(","), d = x.lastIndexOf(".");
  if (c > d) x = x.replace(/\./g, "").replace(",", ".");
  else x = x.replace(/,/g, "");
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const INTERACTIVE = new Set(["click", "type", "fill", "select", "check", "uncheck", "press", "tap"]);
const noise = (s) => /favicon\.ico/i.test(s);

// Tags often send a few seconds after a page loads. Kane records network
// traffic per step, and nothing between steps, so a page load near the end of
// a step can be followed by requests nobody recorded. A clean network result
// only counts if the seconds after the last page load were recorded.
const SETTLE_MS = 6000;
const NETWORK_KINDS = new Set(["request", "visitorId", "cookie", "typed", "text", "variable"]);
function coverage(pack) {
  return pack.sections.map((s) => {
    const t = [...s.actions.map((a) => a.time), ...s.requests.map((r) => r.time)].filter(Boolean);
    return t.length ? [Math.min(...t), Math.max(...t)] : null;
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);
}
function recordedMs(intervals, from, to) {
  let got = 0;
  for (const [a, b] of intervals) got += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return got;
}
function settle(pack) {
  const home = homeSite(pack);
  // Page loads: HTML documents from the site, GET or POST (a form submit is a page load too).
  const docs = pack.requests.filter((r) => site(hostOf(r.url)) === home && (r.mime ? /html/i.test(r.mime) : r.method === "GET" && !/\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|json)(\?|$)/i.test(r.url)));
  if (!docs.length) return null;
  const last = docs.reduce((a, b) => ((b.time || 0) > (a.time || 0) ? b : a));
  const covered = recordedMs(coverage(pack), last.time, last.time + SETTLE_MS);
  return covered < SETTLE_MS - 250 ? { gap: covered, url: last.url } : null;
}

// ---------- judging ----------
function judgeRule(pack, r) {
  const pass = (detail) => ({ rule: r.text, status: "pass", detail });
  const fail = (detail, evidence = []) => ({ rule: r.text, status: "fail", detail, evidence });
  const unknown = (detail) => ({ rule: r.text, status: "unknown", detail });
  const m = r.m;

  switch (r.kind) {
    case "request": {
      const target = m[1].trim().toLowerCase();
      const w = windowed(pack, pack.requests, m[2], m[3]);
      if (w.error) return unknown(w.error);
      let hits;
      if (/^(a |any )?trackers?$/.test(target)) {
        hits = w.items.map((x) => ({ r: x, h: trackerHit(x) })).filter((x) => x.h && x.h.counted).map((x) => x.r);
      } else if (/^(a |any )?third[- ]part(y|ies)$|^(any )?other sites?$/.test(target)) {
        const home = homeSite(pack);
        if (!home) return unknown("could not tell which site Kane was testing");
        hits = w.items.filter((x) => { const h = hostOf(x.url); return h && site(h) !== home; });
      } else {
        const host = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        hits = w.items.filter((x) => { const h = hostOf(x.url).toLowerCase(); return h === host || h.endsWith("." + host); });
      }
      if (!pack.requests.length) return unknown("the evidence pack has no network recording");
      return hits.length
        ? fail(`${plural(hits.length, "request")} ${w.scope}: ${sample(hits, (x) => `${x.method} ${short(x.url)}`).join("; ")}${hits.length > 3 ? "; ..." : ""}`, hits.map((x) => ({ time: x.iso, method: x.method, url: x.url, step: x.section })))
        : pass(`none of the ${plural(w.items.length, "request")} ${w.scope} matched`);
    }
    case "visitorId": {
      const w = windowed(pack, pack.requests, m[1], m[2]);
      if (w.error) return unknown(w.error);
      const ids = [];
      for (const x of w.items) {
        const h = trackerHit(x);
        if (!h || !h.counted) continue;
        const id = consent.visitorId(h.url);
        if (id) ids.push({ x, id });
      }
      const distinct = [...new Set(ids.map((i) => `${i.id.kind}: ${i.id.value}`))];
      return ids.length
        ? fail(`${plural(ids.length, "request")} ${w.scope} carried a visitor ID (${distinct.join("; ")})`, ids.map((i) => ({ time: i.x.iso, url: i.x.url, id: i.id })))
        : pass(`no visitor ID went to a tracker ${w.scope}`);
    }
    case "cookie": {
      const w = windowed(pack, pack.requests, m[1], m[2]);
      if (w.error) return unknown(w.error);
      const names = new Set();
      for (const x of w.items) for (const c of [...x.setCookies, ...x.sentCookies]) if (isTrackerCookie(c)) names.add(c);
      return names.size ? fail(`tracker cookies present ${w.scope}: ${[...names].join(", ")}`) : pass(`no tracker cookie ${w.scope}`);
    }
    case "typed": {
      const step = findStep(pack, m[1]);
      if (!step) return unknown(`there is no step called "${m[1]}" in this run`);
      const values = typedValues(step.section ? step.section.actions : pack.actions.filter((a) => a.time >= step.start && a.time <= step.end));
      if (!values.length) return unknown(`Kane typed nothing it recorded in "${step.label}"`);
      const { home, found } = leaks(pack, values);
      if (!home) return unknown("could not tell which site Kane was testing");
      return found.length
        ? fail(`what was typed in "${step.label}" reached ${plural(new Set(found.map((f) => f.host)).size, "other host")}: ${sample(found, (f) => `${f.host} (${f.how})`).join("; ")}`, found)
        : pass(`${plural(values.length, "typed value")} stayed on ${home}`);
    }
    case "text":
    case "variable": {
      let value = m[1];
      if (r.kind === "variable") {
        value = variables(pack)[m[1].toLowerCase()];
        if (value == null) return unknown(`Kane stored no variable named ${m[1]} in this run`);
      }
      const { home, found } = leaks(pack, [value]);
      if (!home) return unknown("could not tell which site Kane was testing");
      return found.length
        ? fail(`the value reached ${sample(found, (f) => `${f.host} (${f.how})`).join("; ")}`, found)
        : pass(`the value stayed on ${home}`);
    }
    case "server": {
      if (!pack.requests.length) return unknown("the evidence pack has no network recording");
      const bad = pack.requests.filter((x) => x.status >= 500);
      return bad.length ? fail(`${plural(bad.length, "server error")}: ${sample(bad, (x) => `${x.status} ${short(x.url)}`).join("; ")}`, bad.map((x) => ({ time: x.iso, status: x.status, url: x.url }))) : pass(`no 5xx in ${plural(pack.requests.length, "request")}`);
    }
    case "failed": {
      const home = homeSite(pack);
      if (!home) return unknown("could not tell which site Kane was testing");
      const bad = pack.requests.filter((x) => x.status >= 400 && site(hostOf(x.url)) === home && !noise(x.url));
      return bad.length ? fail(`${plural(bad.length, "failed request")} to ${home}: ${sample(bad, (x) => `${x.status} ${short(x.url)}`).join("; ")}`, bad.map((x) => ({ time: x.iso, status: x.status, url: x.url }))) : pass(`every request to ${home} succeeded`);
    }
    case "console": {
      const bad = pack.console.filter((c) => c.level === "error" && !noise(`${c.text} ${c.url}`));
      return bad.length ? fail(`${plural(bad.length, "console error")}: ${sample(bad, (c) => c.text.slice(0, 120)).join("; ")}`, bad) : pass("no console errors");
    }
    case "compare": {
      const vars = variables(pack);
      const val = (tok) => (tok.startsWith("$") ? (vars[tok.slice(1).toLowerCase()] != null ? money(vars[tok.slice(1).toLowerCase()]) : undefined) : Number(tok));
      const a = val("$" + m[1]), b = val(m[3]), c = m[4] ? val(m[4]) : 0;
      const missing = [["$" + m[1], a], [m[3], b], [m[4] || "", c]].filter(([k, v]) => k && (v === undefined || v === null)).map(([k]) => k);
      if (missing.length) return unknown(`Kane recorded no number for ${missing.join(", ")}`);
      const limit = Math.round((b + c) * 100) / 100;
      const op = m[2].toLowerCase();
      const ok = op === "equals" ? Math.abs(a - limit) < 0.005 : op === "is at most" ? a <= limit + 0.005 : a >= limit - 0.005;
      const said = `$${m[1]} = ${a}, ${m[3]}${m[4] ? ` plus ${m[4]}` : ""} = ${limit}`;
      return ok ? pass(said) : fail(`${said}: the first ${op === "equals" ? "does not equal" : op === "is at most" ? "is more than" : "is less than"} the second`);
    }
    case "clicks": {
      const A = findStep(pack, m[1]), B = findStep(pack, m[2]);
      if (!A || !B) return unknown(`there is no step called "${!A ? m[1] : m[2]}" in this run`);
      if (!A.section || !B.section) return unknown("click counts need steps from a Kane test file");
      const n = (s) => s.actions.filter((a) => INTERACTIVE.has(a.type) && a.status !== "failed").length;
      const extra = Number(m[3] || 0);
      const a = n(A.section), b = n(B.section);
      return a <= b + extra
        ? pass(`"${A.label}" took ${plural(a, "click")}, "${B.label}" took ${b}${extra ? ` (allowed ${b + extra})` : ""}`)
        : fail(`"${A.label}" took ${plural(a, "click")}, more than the ${b + extra} allowed by "${B.label}"`);
    }
    default:
      return unknown(`Statute doesn't understand this rule. See "statute expect --help" for the ones it knows`);
  }
}

// The verdict over all rules: any fail -> violation; else any unknown -> inconclusive.
function judge(pack, lines) {
  const early = settle(pack);
  const results = lines.map((l) => {
    const r = parse(l);
    const out = judgeRule(pack, r);
    if (early && out.status === "pass" && NETWORK_KINDS.has(r.kind)) {
      return { ...out, status: "unknown", detail: `${out.detail}, but Kane recorded only ${(early.gap / 1000).toFixed(1)} s of network traffic after the last page loaded (${short(early.url)}); Kane records traffic inside steps, not between them. Tags often send later than that, so this clean result proves nothing. End the step that loads the page with a wait, for example "Then wait 10 seconds."` };
    }
    return out;
  });
  const failed = results.filter((r) => r.status === "fail");
  const unknown = results.filter((r) => r.status === "unknown");
  const verdict = failed.length ? "violation" : unknown.length ? "inconclusive" : "pass";
  const why = failed.length
    ? `${plural(failed.length, "expectation")} broken: ${failed.map((r) => r.rule).join("; ")}.`
    : unknown.length
    ? `${plural(unknown.length, "expectation")} could not be checked from this evidence.`
    : `All ${plural(results.length, "expectation")} held.`;
  return { verdict, why, kaneStatus: pack.kaneStatus, results, site: homeSite(pack) };
}

module.exports = { parse, judge, judgeRule, RULES, site, forms, typedValues, money, settle, coverage, homeSite, trackerHit, hostOf, SETTLE_MS };
