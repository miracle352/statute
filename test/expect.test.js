const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const expect = require("../src/expect");
const packReader = require("../src/pack");

// A pack in the shape src/pack.js returns, built by hand.
const T0 = Date.parse("2026-11-24T10:00:00Z");
const ms = (s) => T0 + s * 1000;
function pack({ sections }) {
  const secs = sections.map((s, i) => ({
    index: i, title: s.title,
    actions: (s.actions || []).map((a) => ({ section: i, status: "passed", instruction: "", intent: "", params: {}, ...a, time: ms(a.at) })),
    requests: (s.requests || []).map((r) => ({ section: i, method: "GET", status: 200, body: "", setCookies: [], sentCookies: [], ...r, time: ms(r.at), iso: new Date(ms(r.at)).toISOString() })),
    console: (s.console || []).map((c) => ({ section: i, ...c })),
  }));
  return { sections: secs, actions: secs.flatMap((s) => s.actions), requests: secs.flatMap((s) => s.requests), console: secs.flatMap((s) => s.console), kaneStatus: "passed" };
}
const one = (p, rule) => expect.judge(p, [rule]).results[0];

const shop = pack({ sections: [
  { title: "Refuse cookies", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }, { type: "click", instruction: "Clicking Reject all", at: 5 }, { type: "wait", at: 7 }],
    requests: [{ url: "https://shop.example.com/", at: 0 }, { url: "https://www.googletagmanager.com/gtag/js?id=G-1", at: 1 }] },
  { title: "Sign up", actions: [{ type: "type", params: { value: "Jane.Doe@Example.com" }, instruction: "Typing into Email", at: 10 }, { type: "click", instruction: "Clicking Sign up", at: 11 }],
    requests: [
      { url: "https://www.google-analytics.com/g/collect?v=2&tid=G-1&cid=123.456&dl=https%3A%2F%2Fshop.example.com%2Fthanks%3Femail%3Djane.doe%2540example.com", method: "POST", at: 12 },
      { url: "https://shop.example.com/api/subscribe", method: "POST", body: '{"email":"jane.doe@example.com"}', at: 11 },
      { url: "https://shop.example.com/missing.png", status: 404, at: 12 },
    ],
    console: [{ level: "error", text: "Uncaught TypeError: x is undefined" }, { level: "error", text: "Failed to load resource", url: "https://shop.example.com/favicon.ico" }] },
] });

test("a tracker hit after the step breaks 'no request to a tracker after'", () => {
  const r = one(shop, 'no request to a tracker after "Refuse cookies"');
  assert.equal(r.status, "fail");
  assert.match(r.detail, /google-analytics\.com\/g\/collect/);
});
test("the bare Tag Manager library is listed but not counted as tracking", () => {
  assert.equal(one(shop, 'no request to a tracker before "Refuse cookies"').status, "pass");
});
test("a visitor ID sent to Google is caught", () => assert.equal(one(shop, 'no visitor ID sent to a tracker after "Refuse cookies"').status, "fail"));
test("an email in a tracker's page address is a leak, even double-encoded", () => {
  const r = one(shop, 'text "jane.doe@example.com" never leaves this site');
  assert.equal(r.status, "fail");
  assert.match(r.detail, /google-analytics\.com/);
});
test("what Kane typed is found, and the site's own API doesn't count as leaving", () => {
  const r = one(shop, 'what was typed in "Sign up" never leaves this site');
  assert.equal(r.status, "fail");
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].host, "www.google-analytics.com");
});
test("a SHA-256 hashed email in an ad pixel is caught", () => {
  const h = crypto.createHash("sha256").update("jane.doe@example.com").digest("hex");
  const p = pack({ sections: [{ title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }], requests: [{ url: `https://www.facebook.com/tr/?id=1&ev=Lead&ud[em]=${h}`, at: 3 }] }] });
  const r = one(p, 'text "Jane.Doe@example.com" never leaves this site');
  assert.equal(r.status, "fail");
  assert.match(r.detail, /SHA-256/);
});
test("an address that stays on the site passes", () => {
  const p = pack({ sections: [{ title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }], requests: [{ url: "https://shop.example.com/api", method: "POST", body: "email=jane.doe%40example.com", at: 1 }] }] });
  assert.equal(one(p, 'text "jane.doe@example.com" never leaves this site').status, "pass");
});
test("server errors, failed requests and console errors", () => {
  assert.equal(one(shop, "no server errors").status, "pass");
  assert.equal(one(shop, "no failed requests to this site").status, "fail");
  const c = one(shop, "no console errors");
  assert.equal(c.status, "fail");
  assert.match(c.detail, /1 console error:/, "favicon noise is ignored");
});
test("numbers Kane stored are compared", () => {
  const p = pack({ sections: [{ title: "Checkout", actions: [
    { type: "analyze", variable: "product_price", value: "€49.00", at: 1 },
    { type: "analyze", variable: "checkout_total", value: "€53,99", at: 2 },
    { type: "analyze", variable: "shipping", value: "0.00", at: 3 },
  ] }] });
  assert.equal(one(p, "value $checkout_total is at most $product_price plus $shipping").status, "fail");
  assert.equal(one(p, "value $checkout_total is at most $product_price plus 5").status, "pass");
  assert.equal(one(p, "value $missing equals $product_price").status, "unknown");
});
test("click counts per step", () => {
  const p = pack({ sections: [
    { title: "Subscribe", actions: [{ type: "click", at: 1 }] },
    { title: "Cancel", actions: [{ type: "click", at: 2 }, { type: "click", at: 3 }, { type: "click", at: 4 }] },
  ] });
  assert.equal(one(p, 'clicks in "Cancel" at most clicks in "Subscribe" plus 1').status, "fail");
  assert.equal(one(p, 'clicks in "Cancel" at most clicks in "Subscribe" plus 2').status, "pass");
});
test("unknown rules and missing steps are never a pass", () => {
  assert.equal(one(shop, "the page is nice").status, "unknown");
  assert.equal(one(shop, 'no request to a tracker after "Nope"').status, "unknown");
  assert.equal(expect.judge(shop, ["no server errors", "the page is nice"]).verdict, "inconclusive");
});
test("one broken expectation makes a violation", () => {
  assert.equal(expect.judge(shop, ["no server errors", "no console errors"]).verdict, "violation");
});
test("expectations are read from the comment Kane ignores", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "examples", "expect", "newsletter_test.md"), "utf8");
  assert.deepEqual(packReader.expectations(md).slice(0, 2), ['text "jane.doe@example.com" never leaves this site', 'what was typed in "Sign up for the newsletter" never leaves this site']);
  assert.deepEqual(packReader.headings(md), ["Accept cookies", "Sign up for the newsletter", "Confirmation"]);
});
test("real pack: Kane PASSED the test file, the expectation fails", () => {
  const dir = path.join(__dirname, "..", "replays", "kane-testmd-demo-shop", "evidence");
  const p = packReader.read(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".evidence"))));
  assert.equal(p.kaneStatus, "passed");
  assert.deepEqual(p.titles, ["Refuse cookies", "Browse one page", "Reload"]);
  const r = expect.judge(p, ['no request to a tracker after "Refuse cookies"', 'no visitor ID sent to a tracker after "Refuse cookies"']);
  assert.equal(r.verdict, "violation");
});

test("a clean network result from a run that ended right after a page load proves nothing", () => {
  const p = pack({ sections: [{ title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }, { type: "click", at: 10 }],
    requests: [{ url: "https://shop.example.com/", at: 0 }, { url: "https://shop.example.com/thanks?email=jane%40x.com", at: 10 }] }] });
  const r = expect.judge(p, ['text "jane@x.com" never leaves this site', "no server errors"]);
  assert.equal(r.results[0].status, "unknown");
  assert.match(r.results[0].detail, /proves nothing/);
  assert.match(r.results[0].detail, /not between them/);
  assert.equal(r.results[1].status, "pass", "non-network rules are unaffected");
  assert.equal(r.verdict, "inconclusive");
});
test("a leak is still a leak even if the run ended early", () => {
  const p = pack({ sections: [{ title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }],
    requests: [{ url: "https://shop.example.com/thanks", at: 1 }, { url: "https://www.google-analytics.com/g/collect?dl=x&em=jane%40x.com", at: 2 }] }] });
  assert.equal(expect.judge(p, ['text "jane@x.com" never leaves this site']).verdict, "violation");
});

test("a hole between steps counts as unrecorded, even if the run went on", () => {
  const p = pack({ sections: [
    { title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }, { type: "click", at: 10 }],
      requests: [{ url: "https://shop.example.com/", at: 0 }, { url: "https://shop.example.com/thanks?e=jane%40x.com", at: 10 }] },
    { title: "Confirm", actions: [{ type: "wait", at: 30 }, { type: "assert", at: 40 }] },
  ] });
  assert.equal(expect.judge(p, ['text "jane@x.com" never leaves this site']).results[0].status, "unknown");
});
test("traffic recorded for the seconds after the last load lets a clean result count", () => {
  const p = pack({ sections: [
    { title: "Sign up", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }, { type: "click", at: 10 }, { type: "wait", at: 20 }],
      requests: [{ url: "https://shop.example.com/", at: 0 }, { url: "https://shop.example.com/thanks", at: 10 }] },
  ] });
  assert.equal(expect.judge(p, ['text "jane@x.com" never leaves this site']).results[0].status, "pass");
});

test("judge page view: flags only the request that carried the email, and reads packs from bytes", () => {
  const { view } = require("../src/expect-view");
  const file = path.join(__dirname, "..", "replays", "newsletter-expect", "evidence", "newsletter_test-round1-1795518837738.evidence");
  const p = packReader.readBuffer(fs.readFileSync(file));
  const v = view(p, expect.judge(p, p.expectations));
  const bad = v.requests.filter((r) => r.flagged);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].host, "www.google-analytics.com");
  assert.match(bad[0].url, /email%3Djane\.doe%2540example\.com/);
  assert.ok(v.requests.filter((r) => !r.flagged).every((r) => r.url === null));
  assert.deepEqual(v.loads.map((l) => l.path), ["/", "/newsletter"]);
});

test("judge API: a sample is judged, junk is refused, nothing is kept", async () => {
  const api = require("../server/expect");
  const { Readable } = require("stream");
  const call = (body, headers) => new Promise((resolve) => {
    const req = Object.assign(Readable.from([Buffer.from(body)]), { headers });
    api.handle(req, {}, { ip: "test", sendJson: (_res, code, json) => resolve({ code, json }) });
  });
  const ok = await call(JSON.stringify({ sample: "before" }), { "content-type": "application/json" });
  assert.equal(ok.code, 200);
  assert.equal(ok.json.kaneStatus, "passed");
  assert.equal(ok.json.verdict, "violation");
  const edited = await call(JSON.stringify({ sample: "before", rules: ["no server errors"] }), { "content-type": "application/json" });
  assert.equal(edited.json.verdict, "pass");
  const junk = await call("not a zip at all, just some text here", { "content-type": "application/octet-stream" });
  assert.equal(junk.code, 400);
});

test("a search term sent as form encoding inside a tag's own URL still counts", () => {
  const p = pack({ sections: [
    { title: "Open", actions: [{ type: "navigate", params: { url: "https://shop.example.com/" }, at: 0 }], requests: [{ url: "https://shop.example.com/", at: 0 }] },
    { title: "Search the site", actions: [{ type: "fill", params: { value: "pregnancy test" }, at: 2 }, { type: "wait", at: 20 }],
      requests: [{ url: "https://shop.example.com/search?q=pregnancy+test", at: 3 },
        { url: "https://www.facebook.com/tr/?id=1&ev=PageView&dl=https%3A%2F%2Fshop.example.com%2Fsearch%3Fq%3Dpregnancy%252Btest", at: 6 }] },
  ] });
  const r = one(p, 'what was typed in "Search the site" never leaves this site');
  assert.equal(r.status, "fail");
  assert.equal(r.evidence[0].host, "www.facebook.com");
  assert.equal(r.evidence[0].how, "URL-encoded");
});
