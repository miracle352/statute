const test = require("node:test");
const assert = require("node:assert/strict");
const consent = require("../src/packs/consent");
const accept = require("../src/packs/consent-accept");
const { click, req, net } = require("./helpers");

const GA = (s, cid = "123.456") => req(`https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=${cid}`, s);
const SHOP = (s) => req("https://shop.example/", s);

test("trackers after Reject are a violation, and the visitor ID is named", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all in the cookie banner", 5)], requests: [SHOP(1), GA(8), GA(9)] }) });
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /2 tracker requests after the visitor clicked "Reject"/);
  assert.match(r.why, /same visitor ID went out more than once/);
});

test("no tracker after Reject passes", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all", 5)], requests: [SHOP(1), SHOP(6)] }) });
  assert.equal(r.verdict, "pass");
});

test("a tracker before the choice counts too", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Decline", 5)], requests: [GA(2)] }) });
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /before they had chosen anything/);
});

test("Google Tag Manager's own code alone is shown but not counted", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all", 5)], requests: [req("https://www.googletagmanager.com/gtag/js?id=G-ABC", 6)] }) });
  assert.equal(r.verdict, "pass");
  assert.equal(r.trackerRequests[0].notCounted, true);
});

test("Consent Mode pings that say denied are not counted", () => {
  const denied = req("https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&gcd=13p3p3p2p5l1&cid=1.2", 8);
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all", 5)], requests: [denied] }) });
  assert.equal(r.verdict, "pass");
  assert.equal(r.cookielessPings, 1);
});

test("own app with no way to refuse and trackers firing is a violation (strict)", () => {
  const r = consent.judge({ strict: true, network: net({ actions: [], requests: [GA(2)] }) });
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /no way to refuse cookies/);
});

test("a third-party site with no banner shown is not judged", () => {
  const r = consent.judge({ network: net({ actions: [], requests: [GA(2)] }) });
  assert.equal(r.verdict, "inconclusive");
});

test("an empty network recording is never a pass", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all", 5)], requests: [], harFiles: 0 }) });
  assert.equal(r.verdict, "inconclusive");
});

test("tracker cookies set after Reject are a violation", () => {
  const r = consent.judge({ network: net({ actions: [click("Clicking Reject all", 5)], requests: [{ ...SHOP(6), setCookies: ["_ga"] }] }) });
  assert.equal(r.verdict, "violation");
  assert.deepEqual(r.trackerCookies, ["_ga"]);
});

test("tracker domains match subdomains and paths, not lookalikes", () => {
  assert.ok(consent.matchDomain(new URL("https://region1.google-analytics.com/g/collect")));
  assert.ok(consent.matchDomain(new URL("https://www.facebook.com/tr?id=1")));
  assert.equal(consent.matchDomain(new URL("https://www.facebook.com/somepage")), null);
  assert.equal(consent.matchDomain(new URL("https://notgoogle-analytics.com.evil.example/")), null);
});

test("the GTM tag ID is not mistaken for a visitor ID", () => {
  assert.equal(consent.visitorId(new URL("https://www.googletagmanager.com/gtm.js?cid=G-ABC")), null);
  assert.equal(consent.visitorId(new URL("https://x.google-analytics.com/g/collect?tid=G-1&cid=55.66")).value, "55.66");
});

test("Accept check: tags must still load after Accept", () => {
  const ok = accept.judge({ network: net({ actions: [click("Clicking Accept all", 5)], requests: [GA(7)] }) });
  assert.equal(ok.verdict, "pass");
  const off = accept.judge({ network: net({ actions: [click("Clicking Accept all", 5)], requests: [SHOP(7)] }) });
  assert.equal(off.verdict, "violation", "deleting analytics must not pass as a fix");
});
