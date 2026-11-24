// Reads a sealed Kane evidence pack into one structure the rules can query:
// the test file, its steps (sections), and per step the actions Kane took, the
// network requests (with bodies) and the console messages, all time-stamped.
const fs = require("fs");
const zip = require("./zip");

const text = (buf, e) => zip.read(buf, e).toString("utf8");
const ndjson = (s) => s.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const t = (iso) => (iso ? Date.parse(iso) : null);

// "---\nmode: testing\nexpect:\n  - a\n  - b\n---" -> { mode: "testing", expect: ["a","b"] }
// Only what Statute needs: scalars and one level of "- item" lists.
function frontmatter(md) {
  const m = String(md || "").match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let list = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && list) { list.push(unquote(item[1])); continue; }
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === "") { list = out[kv[1]] = []; continue; }
    list = null;
    out[kv[1]] = unquote(kv[2]);
  }
  return out;
}
function unquote(s) {
  s = s.trim();
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

// "## Refuse cookies" headings, in order. Kane writes one log set per heading.
function headings(md) {
  const body = String(md || "").replace(/^﻿?---\r?\n[\s\S]*?\r?\n---/, "");
  return [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

function read(packPath) {
  return readBuffer(fs.readFileSync(packPath), packPath);
}

// The same, from the bytes of a pack (an upload, say).
function readBuffer(buf, packPath = null) {
  const list = zip.entries(buf);
  const md = list.find((e) => /(^|\/)test\.md$/.test(e.name));
  const testMd = md ? text(buf, md) : null;
  const titles = headings(testMd);
  const sections = new Map();
  const section = (i) => {
    if (!sections.has(i)) sections.set(i, { index: i, title: titles[i] || (titles.length ? `step ${i + 1}` : "run"), actions: [], requests: [], console: [] });
    return sections.get(i);
  };

  for (const e of list) {
    const m = e.name.match(/logs\/(?:(\d+)-)?(actions\.ndjson|network\.har|console\.ndjson)$/);
    if (!m) continue;
    const s = section(Number(m[1] || 0));
    const raw = text(buf, e);
    if (m[2] === "actions.ndjson") {
      for (const a of ndjson(raw)) {
        s.actions.push({
          section: s.index, type: a.action_type, status: a.status, time: t(a.timestamp),
          instruction: a.action_instruction || "", intent: a.intent || "",
          params: a.action_params || {}, variable: a.output_variable || null,
          value: a.output_value == null ? null : String(a.output_value),
        });
      }
    } else if (m[2] === "network.har") {
      let har;
      try { har = JSON.parse(raw); } catch { continue; }
      for (const h of (har.log && har.log.entries) || []) {
        const req = h.request || {};
        const res = h.response || {};
        const sent = new Set((req.cookies || []).map((c) => c.name));
        for (const x of req.headers || []) {
          if (x.name.toLowerCase() === "cookie") for (const p of x.value.split(";")) { const n = p.split("=")[0].trim(); if (n) sent.add(n); }
        }
        s.requests.push({
          section: s.index, time: t(h.startedDateTime), iso: h.startedDateTime, method: req.method, url: req.url,
          status: res.status, body: (req.postData && req.postData.text) || "",
          mime: (res.content && res.content.mimeType) || "",
          setCookies: (res.headers || []).filter((x) => x.name.toLowerCase() === "set-cookie").map((x) => x.value.split("=")[0].trim()),
          sentCookies: [...sent],
        });
      }
    } else {
      for (const c of ndjson(raw)) if (!c.marker) s.console.push({ section: s.index, level: c.level, text: c.text || "", url: c.url || "" });
    }
  }

  const ordered = [...sections.values()].sort((a, b) => a.index - b.index);
  for (const s of ordered) { s.actions.sort((a, b) => (a.time || 0) - (b.time || 0)); s.requests.sort((a, b) => (a.time || 0) - (b.time || 0)); }
  const result = list.find((e) => /(^|\/)result\.yaml$/.test(e.name));
  const resultText = result ? text(buf, result) : "";
  const status = (resultText.match(/^status:\s*(\S+)/m) || [])[1] || null;
  const shareLink = (resultText.match(/sharable_link:\s*(\S+)/) || [])[1] || null;

  return {
    path: packPath,
    testMd, frontmatter: frontmatter(testMd), expectations: expectations(testMd), titles,
    sections: ordered,
    actions: ordered.flatMap((s) => s.actions),
    requests: ordered.flatMap((s) => s.requests),
    console: ordered.flatMap((s) => s.console),
    kaneStatus: status, shareLink,
  };
}

// Expectations live in an HTML comment in the test file, which Kane ignores:
//   <!-- expect
//   - no request to a tracker after "Refuse cookies"
//   -->
function expectations(md) {
  const out = [];
  for (const m of String(md || "").matchAll(/<!--\s*expect\b([\s\S]*?)-->/gi)) {
    for (const line of m[1].split(/\r?\n/)) {
      const x = line.match(/^\s*[-*]\s+(.+?)\s*$/);
      if (x) out.push(x[1]);
    }
  }
  return out;
}

module.exports = { read, readBuffer, frontmatter, headings, expectations };
