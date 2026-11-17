// Lumen: a small lighting shop. Zero dependencies. Run: npm start (PORT defaults to 3000)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
// Optional path prefix so the shop can be mounted inside another site (e.g. /demo).
const BASE = (process.env.BASE || "").replace(/\/$/, "");
const PUB = path.join(__dirname, "public");

const PRODUCTS = [
  { id: "lamp", name: "Halo Desk Lamp", price: 49.0, img: "desk-sq.jpg", blurb: "Adjustable arm, warm halogen glow, a base that stays put." },
  { id: "fold", name: "Fold Pendant", price: 129.0, img: "pendant-sq.jpg", blurb: "Folded white panels that throw soft light across a room." },
  { id: "heritage", name: "Heritage Table Lamp", price: 189.0, img: "table-sq.jpg", blurb: "Brass and copper, with a hand-blown glass shade." },
  { id: "bell", name: "Bell Pendant", price: 69.0, img: "inverted-sq.jpg", blurb: "Frosted glass bell on a wrought iron cage." },
];
const eur = (n) => "€" + n.toFixed(2);

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Lumen</title>
<link rel="stylesheet" href="${BASE}/style.css">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-LUMEN0001"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-LUMEN0001');
</script>
</head><body>
<header class="top"><div class="wrap">
  <a href="${BASE}/" class="logo">Lumen</a>
  <nav><a href="${BASE}/#shop">Shop</a><a href="${BASE}/subscribe">Lumen Plus</a><a href="${BASE}/account">Account</a><a href="${BASE}/cart" class="cart">Cart</a></nav>
</div></header>
<main>${body}</main>
<footer class="foot"><div class="wrap">
  <p><strong>Lumen</strong> is a demo shop. Nothing here is for sale.</p>
  <p class="credits">Photos via Wikimedia Commons: halogen desk lamp and folded pendant (CC BY-SA 4.0), table lamp ca. 1900, Cooper Hewitt (public domain), inverted pendant (CC BY 4.0).</p>
</div></footer>
</body></html>`;

const card = (p) => `<article class="card">
  <a href="${BASE}/product/${p.id}" class="card-img"><img src="${BASE}/img/${p.img}" alt="${p.name}" width="640" height="640"></a>
  <h3>${p.name}</h3><p class="muted">${p.blurb}</p>
  <div class="card-row"><span class="price">${eur(p.price)}</span><a class="btn" href="${BASE}/product/${p.id}">View product</a></div>
</article>`;

const lamp = PRODUCTS[0];

const routes = {
  "/": () =>
    page("Lighting", `<section class="hero"><div class="wrap hero-grid">
  <div><h1>Light that works as hard as you do</h1>
  <p class="lead">Lamps for desks, tables and ceilings, picked one at a time.</p>
  <a class="btn btn-lg" href="#shop">Shop lamps</a></div>
  <img src="${BASE}/img/hero.jpg" alt="A folded white pendant lamp glowing in a dark room" width="1400" height="894">
</div></section>
<section class="wrap" id="shop"><h2>Best sellers</h2><div class="grid">${PRODUCTS.map(card).join("")}</div></section>
<section class="wrap plus"><div><h2>Lumen Plus</h2><p>Free bulbs for life and early access to new lamps. €9.00 a month, renews automatically.</p></div><a class="btn btn-lg" href="${BASE}/subscribe">Subscribe</a></section>`),

  "/cart": () =>
    page("Cart", `<section class="wrap narrow"><h1>Your cart</h1>
<div class="line"><img src="${BASE}/img/${lamp.img}" alt="" width="80" height="80"><span>${lamp.name} × 1</span><span class="price">${eur(lamp.price)}</span></div>
<p class="total">Total <strong class="price">${eur(lamp.price)}</strong></p>
<a class="btn btn-lg" href="${BASE}/checkout">Checkout</a></section>`),

  "/checkout": () =>
    page("Checkout", `<section class="wrap narrow"><h1>Review and pay</h1>
<div class="line"><span>${lamp.name}</span><span class="price">${eur(lamp.price)}</span></div>
<p class="total">Total to pay <strong class="price">${eur(lamp.price)}</strong></p>
<button class="btn btn-lg">Pay now</button></section>`),

  // Subscribing takes one click.
  "/subscribe": () =>
    page("Lumen Plus", `<section class="wrap narrow"><h1>Lumen Plus</h1><p class="lead">€9.00 a month, renews automatically. Free bulbs for life.</p>
<a class="btn btn-lg" href="${BASE}/account?plan=plus">Start subscription</a></section>`),

  "/account": () =>
    page("Account", `<section class="wrap narrow"><h1>Your account</h1><div class="box"><p>Plan: <strong>Lumen Plus</strong>, €9.00 a month</p></div>
<a class="btn btn-lg" href="${BASE}/account/cancelled">Cancel subscription</a></section>`),
  "/account/cancelled": () =>
    page("Cancelled", `<section class="wrap narrow"><h1>Subscription cancelled</h1><p class="lead">Lumen Plus ends at the close of this billing period. No further charges.</p></section>`),
};

function productPage(p) {
  return page(p.name, `<section class="wrap product"><img src="${BASE}/img/${p.img}" alt="${p.name}" width="640" height="640">
<div><h1>${p.name}</h1><p class="price price-lg">${eur(p.price)}</p><p class="lead">${p.blurb}</p>
<form method="post" action="${BASE}/cart/add"><button class="btn btn-lg">Add to cart</button></form>
<p class="muted">Free delivery over €100. 30-day returns.</p></div></section>`);
}

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" };

function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (BASE) {
      if (url.pathname === BASE) { res.writeHead(301, { Location: BASE + "/" }); return res.end(); }
      if (!url.pathname.startsWith(BASE + "/")) { res.writeHead(404); return res.end("Not found"); }
      url.pathname = url.pathname.slice(BASE.length);
    }
    if (req.method === "POST" && url.pathname === "/cart/add") {
      res.writeHead(303, { Location: `${BASE}/cart` });
      return res.end();
    }
    const m = url.pathname.match(/^\/product\/([a-z]+)$/);
    const prod = m && PRODUCTS.find((p) => p.id === m[1]);
    const route = prod ? () => productPage(prod) : routes[url.pathname];
    if (route) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(route());
    }
    const file = path.join(PUB, path.normalize(url.pathname).replace(/^([/\\])+/, ""));
    if (file.startsWith(PUB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain", "Cache-Control": "public, max-age=3600" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => console.log(`Lumen on http://localhost:${PORT}${BASE}/`));
}
module.exports = { handler };
