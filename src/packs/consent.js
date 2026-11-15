// Rule pack: "Reject" means reject.
// Kane plays a visitor who refuses cookies and then shops normally. This code
// (not an AI) reads Kane's recorded traffic and decides the verdict.
const trackers = require("../../rules/trackers.json");

const id = "consent";
const title = "Reject means reject";
const rule =
  "When a visitor refuses cookies, no advertising or analytics tracker may load, " +
  "before the choice or after it, and no tracker cookie may be set.";
const laws = [
  { ref: "ePrivacy Directive 2002/58/EC, Art. 5(3)", gist: "storing or reading non-essential data on a device needs prior consent" },
  { ref: "GDPR (EU) 2016/679, Art. 4(11) and Art. 7", gist: "consent must be freely given and as easy to withdraw as to give" },
  { ref: "California Civil Code §1798.120 (CCPA/CPRA)", gist: "consumers may opt out of the sale or sharing of their personal information" },
];

function objective(url) {
  return (
    `Go to ${url}. If a cookie consent banner appears, click the button that rejects all cookies ` +
    `and store that button's text as 'reject_button'. Then open the first product, add it to the cart ` +
    `and go to the cart. Then reload the page. Store the names of all cookies in the browser as 'cookie_names'.`
  );
}

function matchDomain(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.toLowerCase();
  for (const rule of trackers.domains) {
    const [d, ...p] = rule.split("/");
    const pathPrefix = p.length ? "/" + p.join("/") : "";
    if ((host === d || host.endsWith("." + d)) && u.pathname.startsWith(pathPrefix)) return rule;
  }
  return null;
}

const cookieRes = trackers.cookies.map((c) => new RegExp(c));
const isTrackerCookie = (name) => cookieRes.some((r) => r.test(name));

function splitNames(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string") return [];
  return v.split(/[\s,;]+/).map((s) => s.replace(/^["'\[]+|["'\]]+$/g, "")).filter(Boolean);
}

function judge({ end, network }) {
  const fs = (end && end.final_state) || {};
  const rejectButton = fs.reject_button;
  const trackerRequests = [];
  const seen = new Set();
  for (const r of network.requests) {
    const hit = matchDomain(r.url);
    if (!hit) continue;
    const u = new URL(r.url);
    const key = u.hostname + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    trackerRequests.push({ tracker: hit, url: u.origin + u.pathname, status: r.status, time: r.time });
  }
  const cookieNames = new Set(splitNames(fs.cookie_names));
  for (const r of network.requests) for (const c of r.setCookies) cookieNames.add(c);
  const trackerCookies = [...cookieNames].filter(isTrackerCookie);

  let verdict;
  let why;
  if (!rejectButton) {
    verdict = "inconclusive";
    why = "Kane did not find or click a reject button, so this run cannot prove anything either way.";
  } else if (network.harFiles === 0) {
    verdict = "inconclusive";
    why = "The evidence pack has no network recording.";
  } else if (trackerRequests.length || trackerCookies.length) {
    verdict = "violation";
    why = `After the visitor clicked "${rejectButton}", Kane recorded ${trackerRequests.length} tracker request(s) and ${trackerCookies.length} tracker cookie(s).`;
  } else {
    verdict = "pass";
    why = `After the visitor clicked "${rejectButton}", Kane recorded ${network.requests.length} requests and none went to a known tracker.`;
  }
  return { verdict, why, rejectButton, trackerRequests, trackerCookies, totalRequests: network.requests.length };
}

const fixHint =
  "Load each tracker listed above only after the visitor accepts. Before a choice, and after " +
  "Reject, the tags must not load at all (hiding the banner is not enough). Check the stored " +
  "choice on every page load, before any tag script is added. Keep the tags working after Accept.";

module.exports = { id, title, rule, laws, objective, judge, fixHint };
