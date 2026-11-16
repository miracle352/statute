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
      // Cookies the browser sent with this request: proves which cookies existed
      // at that moment, including ones set by JavaScript (like _ga).
      const req = h.request || {};
      const sent = new Set(((req.cookies) || []).map((c) => c.name));
      for (const x of req.headers || []) {
        if (x.name.toLowerCase() !== "cookie") continue;
        for (const part of x.value.split(";")) {
          const n = part.split("=")[0].trim();
          if (n) sent.add(n);
        }
      }
      requests.push({
        time: h.startedDateTime,
        method: req.method,
        url: req.url,
        status: h.response && h.response.status,
        setCookies,
        sentCookies: [...sent],
      });
    }
  }
  // Kane's own log of what it did and when (used to find the moment of a click).
  const actions = [];
  for (const e of list) {
    if (!/logs\/[^/]*actions\.ndjson$/.test(e.name)) continue;
    for (const line of zip.read(buf, e).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const a = JSON.parse(line);
        actions.push({
          type: a.action_type,
          instruction: a.action_instruction || "",
          intent: a.intent || "",
          status: a.status,
          time: a.timestamp,
          outputVariable: a.output_variable || null,
          outputValue: a.output_value == null ? null : a.output_value,
        });
      } catch { /* skip */ }
    }
  }
  // Shareable Kane run link, if the pack carries one.
  let shareLink = null;
  const result = list.find((e) => /result\.yaml$/.test(e.name));
  if (result) {
    const m = zip.read(buf, result).toString("utf8").match(/sharable_link:\s*(\S+)/);
    if (m) shareLink = m[1];
  }
  const screenshots = list.filter((e) => /steps\/[^/]+\/screenshot\.(png|jpg)$/.test(e.name)).map((e) => e.name);
  return { requests, actions, shareLink, screenshots, harFiles: list.filter((e) => e.name.endsWith(".har")).length };
}

module.exports = { newestPack, networkFromPack };
