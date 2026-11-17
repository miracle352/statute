const test = require("node:test");
const assert = require("node:assert/strict");
const price = require("../src/packs/price");
const { net, at } = require("./helpers");

const store = (k, v, s) => ({ type: "store", status: "passed", outputVariable: k, outputValue: v, time: at(s) });
const run = (shown, total, lines) => price.judge({ network: net({ actions: [store("product_price", shown, 1), store("checkout_total", total, 2), store("checkout_lines", lines, 3)] }) });

test("money() reads European and US formats", () => {
  assert.equal(price.money("€49.00"), 49);
  assert.equal(price.money("49,00 €"), 49);
  assert.equal(price.money("$1,299.99"), 1299.99);
  assert.equal(price.money("1.299,99 €"), 1299.99);
  assert.equal(price.money("no price"), null);
});

test("a service fee added at checkout is a violation, named by the shop's own label", () => {
  const r = run("€49.00", "€53.99", "Lamp: €49.00; Service fee: €4.99");
  assert.equal(r.verdict, "violation");
  assert.match(r.why, /4\.99 more than the shown price/);
  assert.match(r.why, /Service fee/);
});

test("shipping and tax may be added", () => {
  const r = run("€49.00", "€62.80", "Lamp: €49.00; Shipping: €4.90; VAT: €8.90");
  assert.equal(r.verdict, "pass");
});

test("shipping in other languages is exempt", () => {
  for (const label of ["Versand", "Livraison", "Envío", "Spedizione"]) {
    assert.equal(run("€49.00", "€53.90", `Lamp: €49.00; ${label}: €4.90`).verdict, "pass", label);
  }
});

test("regression: a fee is a fee even if Kane would call it shipping", () => {
  // Verdicts use the shop's line names, copied verbatim, never Kane's summary.
  const r = run("€49.00", "€53.99", "Lamp – €49.00\nService fee – €4.99");
  assert.equal(r.verdict, "violation");
  assert.deepEqual(r.lines.map((l) => l.label), ["Lamp", "Service fee"]);
});

test("missing readings are not judged", () => {
  const r = price.judge({ network: net({ actions: [store("product_price", "€49.00", 1)] }) });
  assert.equal(r.verdict, "inconclusive");
});
