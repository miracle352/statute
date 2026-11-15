// Companion check: after "Accept", the tags must still work.
// Stops a fix from "passing" the reject check by deleting analytics outright.
const { matchDomain, laws } = require("./consent");

const id = "consent-accept";
const title = "Accept still works";
const rule = "When a visitor accepts cookies, the site's analytics and ads tags load as intended.";

function objective(url) {
  return `Go to ${url}. In the cookie banner, click the button that accepts all cookies. Open the first product.`;
}

const ACCEPT_WORDS = /(accept|agree|allow all|allow cookies|got it|ok)/i;

function judge({ events, network }) {
  let accept = null;
  for (const a of network.actions || []) {
    if (a.type === "click" && a.status !== "failed" && ACCEPT_WORDS.test(`${a.instruction} ${a.intent}`)) {
      accept = { label: a.instruction, time: a.time ? Date.parse(a.time) : null };
      break;
    }
  }
  if (!accept) {
    for (const e of events || []) {
      const r = typeof e.remark === "string" ? e.remark : "";
      if (e.status === "done" && /^click\b/i.test(r) && ACCEPT_WORDS.test(r)) { accept = { label: r, time: null }; break; }
    }
  }
  const after = [];
  for (const r of network.requests) {
    let u;
    try { u = new URL(r.url); } catch { continue; }
    const t = matchDomain(u);
    if (!t) continue;
    const at = r.time ? Date.parse(r.time) : null;
    if (!accept || !accept.time || !at || at >= accept.time) after.push(t);
  }
  const trackers = [...new Set(after)];
  let verdict;
  let why;
  if (!accept) {
    verdict = "inconclusive";
    why = "Kane did not find or click an accept button.";
  } else if (trackers.length) {
    verdict = "pass";
    why = `After "Accept", the tags loaded as intended (${trackers.join(", ")}).`;
  } else {
    verdict = "violation";
    why = 'After "Accept", no analytics or ads tag loaded. The fix seems to have switched tracking off entirely instead of respecting the choice.';
  }
  return { verdict, why, rejectClick: null, trackerRequests: [], trackerCookies: [], acceptClick: accept && accept.label, trackersAfterAccept: trackers };
}

const fixHint = "Load the tags when the visitor clicks Accept, and on later page loads when the stored choice is accepted.";

module.exports = { id, title, rule, laws, objective, judge, fixHint };
