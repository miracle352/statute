// Reads what Kane recorded: network traffic (HAR) from a sealed evidence pack.
const fs = require("fs");
const path = require("path");
const zip = require("./zip");

function newestPack(sessionDir) {
  const dir = path.join(sessionDir, "evidence");
  if (!fs.existsSync(dir)) return null;
  const packs = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".evidence"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return packs[0] || null;
}

function networkFromPack(packPath) {
  const buf = fs.readFileSync(packPath);
  const list = zip.entries(buf);
  const requests = [];
  for (const e of list) {
    if (!/logs\/[^/]*network\.har$/.test(e.name)) continue;
    let har;
    try { har = JSON.parse(zip.read(buf, e).toString("utf8")); } catch { continue; }
    for (const h of (har.log && har.log.entries) || []) {
      const setCookies = ((h.response && h.response.headers) || [])
        .filter((x) => x.name.toLowerCase() === "set-cookie")
        .map((x) => x.value.split("=")[0].trim());
      requests.push({
        time: h.startedDateTime,
        method: h.request && h.request.method,
        url: h.request && h.request.url,
        status: h.response && h.response.status,
        setCookies,
      });
    }
  }
  const screenshots = list.filter((e) => /steps\/[^/]+\/screenshot\.png$/.test(e.name)).map((e) => e.name);
  return { requests, screenshots, harFiles: list.filter((e) => e.name.endsWith(".har")).length };
}

module.exports = { newestPack, networkFromPack };
