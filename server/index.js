// Statute live server: the website, the hosted Lumen demo shop, and live audits.
//   PORT=8080 LT_USERNAME=... LT_ACCESS_KEY=... node server/index.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const audit = require("./audit");
const guard = require("./guard");

process.env.BASE = "/demo";
const shop = require("../demo-store/server.js");

const PORT = Number(process.env.PORT || 8080);
const SITE = path.join(__dirname, "..", "site");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".txt": "text/plain", ".ico": "image/x-icon",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY });
  res.end(JSON.stringify(body));
}

function sendFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": cache || "public, max-age=300", ...SECURITY });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (d) => { b += d; if (b.length > limit) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => resolve(b));
  });
}

const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

async function startAudit(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "Send JSON: { url, pack, confirm }." }); }
  const pack = body.pack === "cancel" ? "cancel" : "consent";
  let target;
  if (body.demo) {
    target = { url: `http://127.0.0.1:${PORT}/demo/`, label: "Lumen demo shop", internal: true };
  } else {
    if (pack !== "consent") return sendJson(res, 400, { error: "The cancel check needs an account on the site, so it runs on the demo shop or from the CLI." });
    if (!body.confirm) return sendJson(res, 400, { error: "Tick the box to confirm you own this site or may test it." });
    try {
      const url = await guard.check(String(body.url || "").trim().slice(0, 300));
      target = { url, label: url.replace(/\/$/, ""), internal: false };
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  try {
    const r = audit.create({ target, pack, ip: clientIp(req) });
    sendJson(res, 200, { ...r, status: audit.status() });
  } catch (e) {
    sendJson(res, e.code || 500, { error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);

  if (p === "/demo" || p.startsWith("/demo/")) return shop.handler(req, res);

  if (p === "/api/status" && req.method === "GET") return sendJson(res, 200, audit.status());
  if (p === "/api/audit" && req.method === "POST") return startAudit(req, res);
  if (p === "/api/loop" && req.method === "GET") return sendJson(res, 200, audit.loopStatus());
  if (p === "/api/loop" && req.method === "POST") {
    try { return sendJson(res, 200, audit.createLoop({ ip: clientIp(req) })); }
    catch (e) { return sendJson(res, e.code || 500, { error: e.message }); }
  }
  let m = p.match(/^\/api\/audit\/([a-f0-9]{12})\/stream$/);
  if (m && req.method === "GET") {
    if (!audit.loadFinished(m[1]) || !audit.subscribe(m[1], res)) return sendJson(res, 404, { error: "No such audit." });
    return;
  }
  m = p.match(/^\/audits\/([a-f0-9]{12})\/?$/);
  if (m) {
    if (p.endsWith(m[1])) { res.writeHead(301, { Location: p + "/" }); return res.end(); }
    return sendFile(res, path.join(audit.DATA, "audits", m[1], "index.html"), "no-store");
  }

  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let file = path.normalize(path.join(SITE, p));
  if (!file.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (p.endsWith("/")) file = path.join(file, "index.html");
  const long = /\/assets\/(fonts|.*\.(png|svg|woff2))/.test(p) ? "public, max-age=604800" : undefined;
  sendFile(res, file, long);
});

server.listen(PORT, () => {
  console.log(`Statute live on http://localhost:${PORT}  (demo shop at /demo/, ${audit.status().left} live audits left today)`);
  if (!process.env.LT_USERNAME) console.log("No LT_USERNAME/LT_ACCESS_KEY set: Kane will use the account you're signed in with (kane-cli login).");
});
