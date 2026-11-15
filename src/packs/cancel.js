// Rule pack: cancelling is as easy as signing up.
// Kane subscribes like a customer, then tries to cancel online. This code
// (not an AI) counts both paths from Kane's action log and decides the verdict.
const { cleanLabel, actionText } = require("./consent");

const id = "cancel";
const title = "Cancel as easy as signup";
const rule =
  "A subscription started online can be cancelled online, and cancelling takes no more steps " +
  "than signing up did (one extra confirmation is allowed). No phone calls, no dead ends.";
const laws = [
  { ref: "California Bus. & Prof. Code §17602 (AB 2863, from 1 July 2025)", gist: "an online subscription must offer online cancellation, as easy as signing up" },
  { ref: "German Civil Code (BGB) §312k", gist: "consumer contracts sold online need a clearly labelled cancellation button" },
  { ref: "EU Directive 2023/2673, Art. 11a (from 19 June 2026)", gist: "withdrawing from an online contract must be possible online and no more burdensome than concluding it" },
];

const ALLOWED_EXTRA = 1; // a single "are you sure?" confirmation

function objective(url) {
  return (
    `Go to ${url}. If a cookie banner appears, click the button that rejects all cookies. ` +
    `Subscribe to the monthly plan and start the subscription. ` +
    `Then cancel that subscription online, the way a customer would, without phoning anyone. ` +
    `Finally, verify that the page confirms the subscription is cancelled.`
  );
}

const INTERACTIVE = new Set(["click", "type", "fill", "select", "check", "uncheck", "press", "tap"]);
const COOKIE = /(cookie|consent|reject all|accept all)/i;
const CANCELISH = /(cancel|unsubscribe|end (my )?(plan|subscription)|withdraw|terminate|leave)/i;
const SIGNUP_DONE = /(start (the )?subscription|start (my )?(plan|trial)|confirm (the )?subscription|subscribe now|complete (the )?(subscription|purchase)|start subscription)/i;
const SUBSCRIBE = /(subscribe|start subscription|join|sign up|get started|start (my )?trial)/i;

function judge({ end, network }) {
  const acts = (network.actions || []).filter((a) => a.status !== "failed");
  const interactive = acts.filter((a) => INTERACTIVE.has(a.type) && !COOKIE.test(actionText(a)));

  // The signup path ends at the last click that completes the subscription
  // (falling back to the last "subscribe" click). Anything about cancelling
  // never counts as signing up.
  const isSignup = (re, a) => re.test(actionText(a)) && !CANCELISH.test(actionText(a));
  let cut = -1;
  interactive.forEach((a, i) => { if (isSignup(SIGNUP_DONE, a)) cut = i; });
  if (cut < 0) interactive.forEach((a, i) => { if (isSignup(SUBSCRIBE, a)) cut = i; });

  const signup = cut >= 0 ? interactive.slice(0, cut + 1) : [];
  const cancel = cut >= 0 ? interactive.slice(cut + 1) : [];
  const label = (a) => cleanLabel(a.instruction);
  const passed = end ? end.status === "passed" : null;
  const reason = end && end.status !== "passed" ? String(end.summary || "").split("\n")[0] : "";
  const limit = signup.length + ALLOWED_EXTRA;

  let verdict;
  let why;
  if (cut < 0) {
    verdict = "inconclusive";
    why = "Kane could not find a way to subscribe, so there is nothing to compare.";
  } else if (passed === false) {
    verdict = "violation";
    why = `Subscribing took ${signup.length} click${signup.length === 1 ? "" : "s"}. Kane then tried ${cancel.length} step${cancel.length === 1 ? "" : "s"} to cancel and never reached a cancellation confirmation.${reason ? ` Kane: “${reason}”` : ""}`;
  } else if (cancel.length > limit) {
    verdict = "violation";
    why = `Cancelling took ${cancel.length} clicks, against ${signup.length} to subscribe (limit: ${limit}, allowing one confirmation).`;
  } else {
    verdict = "pass";
    why = `Subscribing took ${signup.length} click${signup.length === 1 ? "" : "s"} and cancelling took ${cancel.length}, ending on a cancellation confirmation.`;
  }
  return {
    verdict, why,
    signup: signup.map(label), cancel: cancel.map(label),
    signupClicks: signup.length, cancelClicks: cancel.length, limit,
    confirmed: passed === true, kaneReason: reason,
    trackerRequests: [], trackerCookies: [],
  };
}

const fixHint =
  "Give subscribers a clearly labelled cancel button where they manage the plan (the account page), " +
  "cancel online in at most one confirmation step, and show a confirmation that the plan is cancelled. " +
  "No phone-only cancellation, no mandatory survey, no chain of extra screens. A retention offer may " +
  "be shown only if the cancel button stays on the same screen.";

module.exports = { id, title, rule, laws, objective, judge, fixHint };
