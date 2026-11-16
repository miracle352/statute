#!/usr/bin/env node
// Tiny static file server for the examples: node bin/serve.js <port> [dir]
const http = require("http");
const fs = require("fs");
const path = require("path");
const port = Number(process.argv[2] || 8095);
const root = path.resolve(process.argv[3] || ".");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch {}
  // Single-page sites: unknown paths fall back to index.html
  if (!fs.existsSync(file)) file = path.join(root, "index.html");
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://localhost:${port}/`));
