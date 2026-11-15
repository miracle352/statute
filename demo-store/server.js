// Lumen: a tiny shop used to show Statute catching real compliance bugs.
// Zero dependencies. Run: node demo-store/server.js  (PORT defaults to 4173)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const PUB = path.join(__dirname, "public");

const PRODUCT = { id: "lamp", name: "Lumen Desk Lamp", price: 49.0 };
const SERVICE_FEE = 4.99; // added only at the last step (price-honesty bug)

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Lumen</title>
<link rel="stylesheet" href="/style.css">
<script src="/tags.js"></script>
</head><body>
<header><a href="/" class="logo">Lumen</a>
<nav><a href="/cart">Cart</a> <a href="/account">Account</a></nav></header>
<main>${body}</main>
<div id="consent" class="consent" hidden>
  <p>We use cookies to improve your experience and for analytics.</p>
  <button id="accept-all">Accept all</button>
  <button id="reject-all">Reject all</button>
</div>
<script src="/consent.js"></script>
</body></html>`;

const eur = (n) => "€" + n.toFixed(2);

const routes = {
  "/": () =>
    page("Shop", `<h1>Light that works as hard as you do</h1>
<div class="card"><h2>${PRODUCT.name}</h2><p class="price">${eur(PRODUCT.price)}</p>
<a class="btn" href="/product/lamp">View product</a></div>
<div class="card"><h2>Lumen Plus</h2><p>Free bulbs for life. €9.00 / month.</p>
<a class="btn" href="/subscribe">Subscribe</a></div>`),

  "/product/lamp": () =>
    page(PRODUCT.name, `<h1>${PRODUCT.name}</h1><p class="price">${eur(PRODUCT.price)}</p>
<form method="post" action="/cart/add"><button class="btn">Add to cart</button></form>`),

  "/cart": () =>
    page("Cart", `<h1>Your cart</h1><p>${PRODUCT.name} × 1</p>
<p>Total: <strong class="price">${eur(PRODUCT.price)}</strong></p>
<a class="btn" href="/checkout">Checkout</a>`),

  "/checkout": () =>
    page("Checkout", `<h1>Review and pay</h1><p>${PRODUCT.name}: ${eur(PRODUCT.price)}</p>
<p>Service fee: ${eur(SERVICE_FEE)}</p>
<p>Total to pay: <strong class="price">${eur(PRODUCT.price + SERVICE_FEE)}</strong></p>
<button class="btn">Pay now</button>`),

  // Subscribing takes one click.
  "/subscribe": () =>
    page("Subscribe", `<h1>Lumen Plus</h1><p>€9.00 / month, renews automatically.</p>
<a class="btn" href="/account?plan=plus">Start subscription</a>`),

  // Cancelling online: cancel button on the account page, one confirmation, done.
  "/account": () =>
    page("Account", `<h1>Your account</h1><p>Plan: Lumen Plus</p>
<a class="btn" href="/account/cancel">Cancel subscription</a> <a href="/account/settings">Settings</a>`),
  "/account/settings": () =>
    page("Settings", `<h1>Settings</h1><a href="/account/settings/billing">Billing &amp; plan</a>`),
  "/account/settings/billing": () =>
    page("Billing", `<h1>Billing &amp; plan</h1><a class="btn" href="/account/cancel">Cancel subscription</a>`),
  "/account/cancel": () =>
    page("Cancel subscription", `<h1>Cancel Lumen Plus?</h1><p>Your plan will not renew.</p>
<a class="btn" href="/account/cancelled">Confirm cancellation</a> <a href="/account">Keep my plan</a>`),
  "/account/cancelled": () =>
    page("Subscription cancelled", `<h1>Your subscription is cancelled</h1><p>Lumen Plus will not renew. No further charges.</p>`),
};

const TYPES = { ".js": "text/javascript", ".css": "text/css" };

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/cart/add") {
      res.writeHead(303, { Location: "/cart" });
      return res.end();
    }
    const route = routes[url.pathname];
    if (route) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(route());
    }
    const file = path.join(PUB, path.normalize(url.pathname).replace(/^([/\\])+/, ""));
    if (file.startsWith(PUB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  })
  .listen(PORT, () => console.log(`Lumen demo store on http://localhost:${PORT}`));
