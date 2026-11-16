// Rule pack: the price shown is the price paid.
// Kane opens a product, reads the price shown for it, goes to checkout and reads
// the total, shipping and tax there. This code (not an AI) compares the numbers.
const id = "price";
const title = "The price shown is the price paid";
const rule =
  "The first price a shopper sees for a product includes every mandatory fee. At checkout the " +
  "total may add only taxes and shipping on top of it; a fee that only appears at the last step " +
  "breaks the rule.";
const laws = [
  { ref: "California Civil Code §1770(a)(29) (SB 478, from 1 July 2024)", gist: "an advertised price must include all mandatory fees, other than government taxes and shipping" },
  { ref: "UK Digital Markets, Competition and Consumers Act 2024, s.230 (from 6 April 2025)", gist: "the headline price must include mandatory charges; drip pricing is banned" },
  { ref: "EU Consumer Rights Directive 2011/83/EU, Art. 6(1)(e)", gist: "the trader must give the total price of the goods, inclusive of taxes, before the contract" },
];

function objective(url) {
  return (
    `Go to ${url}. Reject all cookies if a banner appears. Open the first product and store the price shown for it in a variable named product_price. ` +
    `Add it to the cart, go to checkout and stop on the page before payment. There, store the total to pay in checkout_total, ` +
    `and copy every line listed between the product and the total, exactly as the page names it, with its amount, into checkout_lines ` +
    `(for example "Delivery: 3.00; Packaging fee: 1.50"; write none if there are no such lines). Do not pay.`
  );
}

// "€1.234,50", "$1,234.50", "1 234,50 EUR", "49" -> number
function money(v) {
  if (v == null) return null;
  const m = String(v).replace(/ /g, " ").match(/-?\d[\d.,\s]*/);
  if (!m) return null;
  let s = m[0].replace(/\s/g, "");
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (/^\d+\.\d{3}$/.test(s) && lastComma < 0 && lastDot >= 0 && !/[.,]\d{1,2}$/.test(m[0])) s = s.replace(".", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function readVars(actions) {
  const vars = {};
  for (const a of actions || []) {
    if (!a.outputVariable || a.outputValue == null || a.status === "failed") continue;
    const k = String(a.outputVariable).toLowerCase().replace(/[^a-z_]/g, "");
    vars[k] = { raw: String(a.outputValue), value: money(a.outputValue), time: a.time };
  }
  return vars;
}

const fmt = (n) => n.toFixed(2);

// Lines a shop may add on top of the shown price: shipping and taxes only.
// The decision uses the shop's own name for each line, not Kane's judgement.
const EXEMPT = /(shipping|delivery|postage|carriage|versand|livraison|envío|envio|spedizione|tax|vat|mwst|tva|iva|gst)/i;

function parseLines(raw) {
  if (!raw || /^\s*(none|no|n\/a|-|0)\s*$/i.test(raw)) return [];
  return String(raw).split(/[;\n]+/).map((part) => {
    const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*(.+)$/) || part.match(/^\s*(.*?[A-Za-z].*?)\s+([-–]?\s*[€$£]?\s*\d[\d.,]*\s*\S*)\s*$/);
    if (!m) return null;
    const amount = money(m[2]);
    const label = m[1].replace(/[\s\u2013\u2014-]+$/, "").trim();
    return amount == null ? null : { label, amount, exempt: EXEMPT.test(label) };
  }).filter(Boolean);
}

function judge({ end, network }) {
  const vars = readVars(network.actions);
  const shown = vars.product_price && vars.product_price.value;
  const total = vars.checkout_total && vars.checkout_total.value;
  const lines = parseLines(vars.checkout_lines && vars.checkout_lines.raw);
  const exempt = lines.filter((l) => l.exempt).reduce((a, l) => a + l.amount, 0);
  const fees = lines.filter((l) => !l.exempt);
  let verdict, why, extra = null;
  if (shown == null || total == null) {
    verdict = "inconclusive";
    why = `Kane did not record both prices (product page: ${vars.product_price ? vars.product_price.raw : "none"}, checkout total: ${vars.checkout_total ? vars.checkout_total.raw : "none"}), so this run cannot prove anything either way.`;
  } else {
    extra = Math.round((total - shown - exempt) * 100) / 100;
    const seen = `the product page showed ${vars.product_price.raw} and the checkout total was ${vars.checkout_total.raw}`;
    const listed = lines.length ? ` The checkout listed ${lines.map((l) => `${l.label} ${fmt(l.amount)}`).join(", ")}.` : "";
    if (extra > 0.009) {
      verdict = "violation";
      const named = fees.length ? ` (${fees.map((l) => l.label).join(", ")})` : "";
      why = `Kane read the prices: ${seen}.${listed} Apart from shipping and tax, ${fmt(extra)} more than the shown price was added at checkout${named}.`;
    } else {
      verdict = "pass";
      why = `Kane read the prices: ${seen}.${listed} Apart from shipping and tax, the shopper pays the price they were shown.`;
    }
  }
  return {
    verdict, why, shown, total, extra, lines,
    shipping: lines.filter((l) => l.exempt && !/tax|vat|mwst|tva|iva|gst/i.test(l.label)).reduce((a, l) => a + l.amount, 0),
    tax: lines.filter((l) => /tax|vat|mwst|tva|iva|gst/i.test(l.label)).reduce((a, l) => a + l.amount, 0),
    readings: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.raw])),
    trackerRequests: [], trackerCookies: [],
  };
}

const fixHint =
  "Show the full price, including every mandatory fee, wherever the product price is first shown " +
  "(product page and cart), or remove the fee. Taxes and shipping may still be listed separately at " +
  "checkout. Do not hide the fee in small print.";

module.exports = { id, title, rule, laws, objective, judge, fixHint, money, parseLines };
