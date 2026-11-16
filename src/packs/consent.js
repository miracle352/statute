// Rule pack: "Reject" means reject.
// Kane plays a visitor who refuses cookies and then shops normally. This code
// (not an AI) reads Kane's recorded traffic and action log and decides the verdict.
const trackers = require("../../rules/trackers.json");

const id = "consent";
const title = "Reject means reject";
const rule =
  "When a visitor refuses cookies, no advertising or analytics tracker may load, " +
  "before the choice or after it, and no visitor ID may be sent to a tracker.";
const laws = [
  { ref: "ePrivacy Directive 2002/58/EC, Art. 5(3)", gist: "storing or reading non-essential data on a device needs prior consent" },
  { ref: "GDPR (EU) 2016/679, Art. 4(11) and Art. 7", gist: "consent must be freely given and as easy to withdraw as to give" },
  { ref: "California Civil Code §1798.120 (CCPA/CPRA)", gist: "consumers may opt out of the sale or sharing of their personal information" },
];

function objective(url) {
  return (
    `Go to ${url}. In the cookie banner, click the button that rejects all cookies. ` +
    `Open the first product. Click the add to cart button. Reload the page.`
  );
}

const REJECT_WORDS = /(reject|decline|refuse|deny|necessary only|only necessary|essential only)/i;

function matchDomain(u) {
  const host = u.hostname.toLowerCase();
  for (const r of trackers.domains) {
    const [d, ...p] = r.split("/");
    const pathPrefix = p.length ? "/" + p.join("/") : "";
    if ((host === d || host.endsWith("." + d)) && u.pathname.startsWith(pathPrefix)) return r;
  }
  return null;
}

// Visitor identifiers that trackers send in the URL. Seeing one proves the
// visitor is being recognised, which is the whole point of the cookie.
const ID_PARAMS = [
  { param: "cid", name: "Google Analytics client ID (_ga cookie)", needs: "tid" },
  { param: "fbp", name: "Meta browser ID (_fbp cookie)" },
  { param: "_fbp", name: "Meta browser ID (_fbp cookie)" },
  { param: "fbc", name: "Meta click ID (_fbc cookie)" },
  { param: "gclid", name: "Google Ads click ID" },
  { param: "uid", name: "user ID" },
];

function visitorId(u) {
  const q = u.searchParams;
  for (const p of ID_PARAMS) {
    const v = q.get(p.param);
    if (!v) continue;
    if (p.needs && !q.get(p.needs)) continue;
    if (p.param === "cid" && /^G-/.test(v)) continue; // GTM uses cid for the tag ID
    return { kind: p.name, value: v };
  }
  return null;
}

// Google Consent Mode: a hit sent with analytics storage denied is a cookieless
// ping, not tracking with a cookie. gcd letters at positions 2,4,6,8 are
// ad_storage, analytics_storage, ad_user_data, ad_personalization; p/q/m/u mean
// the final state is denied, l means Consent Mode is not in use.
const DENIED = new Set(["p", "q", "m", "u"]);
function consentModeDenied(u) {
  const q = u.searchParams;
  const gcd = q.get("gcd");
  if (gcd && gcd.length > 4 && DENIED.has(gcd[4])) return true;
  const gcs = q.get("gcs");
  if (gcs && /^G1[01]0$/.test(gcs)) return true;
  return false;
}

const cookieRes = trackers.cookies.map((c) => new RegExp(c));
const isTrackerCookie = (name) => cookieRes.some((r) => r.test(name));

// "click: Clicking Reject all in the cookie banner" -> "Reject all in the cookie banner"
const cleanLabel = (s) => String(s || "").replace(/^click:\s*/i, "").replace(/^(clicking|clicked|click)\s+(on\s+)?(the\s+)?/i, "").trim().replace(/^"(.*)"$/, "$1");
// What Kane actually clicked: its own description plus the element's visible
// text. Kane's "intent" also carries the objective sentence it is working on,
// which can lag behind, so only the text="..." part of it is used.
function actionText(a) {
  const m = String(a.intent || "").match(/text="([^"]*)"/);
  return `${a.instruction || ""} ${m ? m[1] : ""}`.trim();
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// When did Kane click "Reject"? Prefer the timestamped action log; fall back
// to the progress stream (no timestamp then).
function findReject(actions, events, fallbackTime) {
  for (const a of actions || []) {
    if (a.type === "click" && a.status !== "failed" && REJECT_WORDS.test(actionText(a))) {
      return { label: cleanLabel(a.instruction), time: a.time ? Date.parse(a.time) : null };
    }
  }
  for (const e of events || []) {
    const r = typeof e.remark === "string" ? e.remark : "";
    if (e.status === "done" && /^click\b/i.test(r) && REJECT_WORDS.test(r)) {
      return { label: cleanLabel(r), time: fallbackTime || null };
    }
  }
  return null;
}

// Did Kane see a cookie banner? Kane logs its conditional check
// ("If-else checkpoint ...: condition 'A cookie banner appears.' matched").
function bannerSeen(actions) {
  for (const a of actions || []) {
    const t = `${a.instruction || ""}`;
    if (!/(banner|cookie|consent)/i.test(t)) continue;
    if (a.type === "if_else" || /checkpoint|condition/i.test(t)) {
      if (/(not matched|did not match|unmatched|not met|false)/i.test(t)) return false;
      if (/matched|met|true/i.test(t)) return true;
    }
  }
  return null;
}

function judge({ events, network }) {
  const reject = findReject(network.actions, events, network.liveRejectAt);
  const banner = bannerSeen(network.actions);
  const hits = [];
  for (const r of network.requests) {
    let u;
    try { u = new URL(r.url); } catch { continue; }
    const tracker = matchDomain(u);
    if (!tracker) continue;
    const t = r.time ? Date.parse(r.time) : null;
    const phase = reject && reject.time && t ? (t >= reject.time ? "after" : "before") : "unknown";
    const page = u.searchParams.get("dl") || u.searchParams.get("dp") || null;
    const denied = consentModeDenied(u);
    hits.push({ tracker, url: u.origin + u.pathname, method: r.method, status: r.status, time: r.time, phase, page, id: denied ? null : visitorId(u), denied });
  }

  // Group identical endpoints per phase so the report stays readable.
  const groups = new Map();
  for (const h of hits) {
    const key = `${h.phase}|${h.url}|${h.denied ? "d" : ""}`;
    const g = groups.get(key) || { ...h, count: 0, pages: new Set(), ids: new Set() };
    g.count++;
    if (h.page) g.pages.add(h.page);
    if (h.id) g.ids.add(`${h.id.kind}: ${h.id.value}`);
    groups.set(key, g);
  }
  const trackerRequests = [...groups.values()].map((g) => ({
    phase: g.phase, tracker: g.tracker, url: g.url, method: g.method, status: g.status,
    count: g.count, firstTime: g.time, pages: [...g.pages], ids: [...g.ids], consentDenied: !!g.denied,
  }));

  // If the site uses Consent Mode and its pings say "denied", the tag library
  // loading is part of that design; count only hits that are not denied pings.
  const usesDeniedMode = hits.some((h) => h.denied && h.phase !== "before");
  const counts = (h) => !h.denied && !(usesDeniedMode && /googletagmanager\.com/.test(h.tracker));
  const real = hits.filter(counts);
  const cookieless = hits.filter((h) => h.denied && h.phase !== "before").length;
  const after = real.filter((h) => h.phase === "after");
  const idCounts = new Map();
  for (const h of after) if (h.id) { const k = `${h.id.kind}: ${h.id.value}`; idCounts.set(k, (idCounts.get(k) || 0) + 1); }
  const idsAfter = [...idCounts.keys()];
  const repeated = [...idCounts.entries()].filter(([, n]) => n > 1);

  const cookieNames = new Set();
  for (const r of network.requests) {
    for (const c of r.setCookies || []) cookieNames.add(c);
    for (const c of r.sentCookies || []) cookieNames.add(c);
  }
  const trackerCookies = [...cookieNames].filter(isTrackerCookie);

  let verdict;
  let why;
  if (!reject && banner === false && network.harFiles !== 0) {
    // Many sites show a banner only to visitors in some countries, so a site
    // that showed none to Kane's location is not judged on this run.
    verdict = "inconclusive";
    why = real.length
      ? `No cookie banner was shown to Kane's browser from its location, and ${plural(real.length, "tracker request")} went out. Sites often show banners only to visitors in the EU or UK, so this run can't judge the Reject button.`
      : `No cookie banner was shown to Kane's browser from its location, and no tracker loaded.`;
  } else if (!reject) {
    verdict = "inconclusive";
    why = "Kane did not find or click a reject button, so this run cannot prove anything either way.";
  } else if (network.harFiles === 0) {
    verdict = "inconclusive";
    why = "The evidence pack has no network recording.";
  } else if (real.length || trackerCookies.length) {
    verdict = "violation";
    const parts = [];
    const before = real.filter((h) => h.phase === "before").length;
    if (after.length) parts.push(`${plural(after.length, "tracker request")} after the visitor clicked "Reject"`);
    if (before) parts.push(`${plural(before, "tracker request")} before they had chosen anything`);
    if (!after.length && !before && real.length) parts.push(plural(real.length, "tracker request"));
    if (trackerCookies.length) parts.push(plural(trackerCookies.length, "tracker cookie"));
    why = `Kane recorded ${parts.join(", and ")}.`;
    if (repeated.length) why += ` After "Reject", the same visitor ID went out more than once (${repeated.map(([k, n]) => `${k}, ${n} times`).join("; ")}).`;
    else if (idsAfter.length) why += ` After "Reject", Google Analytics received ${plural(idsAfter.length, "visitor ID")}.`;
    if (cookieless) why += ` ${plural(cookieless, "further hit")} said consent was denied (Google Consent Mode) and were not counted.`;
  } else {
    verdict = "pass";
    why = cookieless
      ? `Kane refused cookies. ${plural(cookieless, "Google hit")} still went out, but each said consent was denied (Google Consent Mode), with no visitor cookie. No other tracker loaded.`
      : `Kane refused cookies and recorded ${plural(network.requests.length, "request")}; none went to a known tracker and no visitor ID was sent.`;
  }

  return {
    verdict, why,
    rejectClick: reject && { label: reject.label, time: reject.time ? new Date(reject.time).toISOString() : null },
    trackerRequests, idsAfterReject: idsAfter, trackerCookies, bannerShown: banner, cookielessPings: cookieless,
    totalRequests: network.requests.length,
  };
}

const fixHint =
  "Load each tracker listed above only after the visitor accepts. Before a choice, and after " +
  "Reject, the tags must not load at all (hiding the banner is not enough). Check the stored " +
  "choice on every page load, before any tag script is added. Keep the tags working after Accept.";

module.exports = { id, title, rule, laws, objective, judge, fixHint, matchDomain, visitorId, cleanLabel, actionText };
