const test = require("node:test");
const assert = require("node:assert/strict");
const { scope } = require("../bin/scope");

const diff = (file, lines) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n` + lines.map((l) => "+" + l).join("\n") + "\n";

test("styling changes run nothing", () => assert.deepEqual(scope(diff("src/button.css", [".btn{color:red}"])).checks, []));
test("docs are ignored even if they mention trackers", () => assert.deepEqual(scope(diff("README.md", ["We use gtag and a service fee"])).checks, []));
test("a pasted Google tag runs the consent check", () => {
  const r = scope(diff("server.js", ['<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>']));
  assert.deepEqual(r.checks, ["consent"]);
  assert.equal(r.reasons.consent[0].why, "a tracker domain");
});
test("a Meta pixel call runs the consent check", () => assert.ok(scope(diff("app.tsx", ['fbq("init","1")'])).checks.includes("consent")));
test("a new fee runs the price check", () => assert.ok(scope(diff("lib/checkout.ts", ["const SERVICE_FEE = 2.5;"])).checks.includes("price")));
test("a cancel page runs the cancel check", () => assert.ok(scope(diff("pages/account/cancel.tsx", ["export default function CancelSubscription() {}"])).checks.includes("cancel")));
test("removed lines count too: deleting a consent check is risky", () => {
  const d = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-if (consent === 'granted') loadTags();\n+loadTags();\n";
  assert.ok(scope(d).checks.includes("consent"));
});
test("glued code names are split into words", () => {
  const d = (l) => scope(diff("src/shop.ts", [l])).checks;
  assert.ok(d("const SERVICE_FEE = 2.5;").includes("price"));
  assert.ok(d("const cartTotal = items.reduce(sum);").includes("price"));
  assert.ok(d("function cancelSubscription(user) {").includes("cancel"));
  assert.ok(d("if (!hasConsent) loadPixel();").includes("consent"));
});
