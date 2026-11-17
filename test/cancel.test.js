const test = require("node:test");
const assert = require("node:assert/strict");
const cancel = require("../src/packs/cancel");
const { click, net } = require("./helpers");

const signup = [click("Clicking Subscribe", 1), click("Clicking Start subscription", 2)];

test("cancelling in as few steps as subscribing passes", () => {
  const r = cancel.judge({ end: { status: "passed" }, network: net({ actions: [...signup, click("Clicking Account", 3), click("Clicking Cancel subscription", 4)] }) });
  assert.equal(r.verdict, "pass");
});

test("a long cancellation path is a violation", () => {
  const steps = ["Account", "Manage plan", "Cancel plan", "Continue to cancel", "No thanks", "Confirm cancellation"].map((t, i) => click(`Clicking ${t}`, 3 + i));
  const r = cancel.judge({ end: { status: "passed" }, network: net({ actions: [...signup, ...steps] }) });
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /Cancelling took 6 clicks, against 2 to subscribe/);
});

test("never reaching a cancellation confirmation is a violation", () => {
  const r = cancel.judge({ end: { status: "failed", summary: "Cancellation requires a phone call" }, network: net({ actions: [...signup, click("Clicking Account", 3)] }) });
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /phone call/);
});

test("no way to subscribe is not judged", () => {
  const r = cancel.judge({ end: { status: "passed" }, network: net({ actions: [click("Clicking Account", 1)] }) });
  assert.equal(r.verdict, "inconclusive");
});
