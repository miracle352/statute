// Builds statute-report/index.html: a self-contained case file of what Kane
// caught, what the agent changed, and what Kane proved. Pure code, no AI.
const fs = require("fs");
const path = require("path");
const zip = require("./zip");
const evidence = require("./evidence");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Tiny, safe markdown: paragraphs, **bold**, `code`.
function md(s) {
  return String(s || "")
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, " ")}</p>`)
    .join("");
}

// Width and height of a JPEG or PNG, read from its header.
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// Step screenshots + captions from a sealed Kane evidence pack.
function steps(packPath) {
  if (!packPath || !fs.existsSync(packPath)) return [];
  const buf = fs.readFileSync(packPath);
  const list = zip.entries(buf);
  // Page size Kane browsed at; screenshots may be taken at a higher pixel ratio.
  let viewW = 0;
  const res = list.find((e) => /result\.yaml$/.test(e.name));
  if (res) {
    const m = zip.read(buf, res).toString("utf8").match(/resolution:\s*'?(\d+)x(\d+)/);
    if (m) viewW = Number(m[1]);
  }
  const out = [];
  for (const e of list) {
    const m = e.name.match(/steps\/(\d+)-[^/]+\/step\.json$/);
    if (!m) continue;
    let s;
    try { s = JSON.parse(zip.read(buf, e).toString("utf8")); } catch { continue; }
    const dir = e.name.replace(/step\.json$/, "");
    const shot = list.find((x) => x.name === dir + "screenshot.jpg" || x.name === dir + "screenshot.png");
    const raw = shot ? zip.read(buf, shot) : null;
    const img = raw ? `data:image/${shot.name.endsWith(".png") ? "png" : "jpeg"};base64,${raw.toString("base64")}` : null;
    const size = raw ? imageSize(raw) : null;
    const caption = String(s.summary || "").replace(/^\w+:\s*/, "").replace(/^(Clicking|Waiting)\s+/i, (w) => w);
    let rect = s.element_rect || null;
    if (rect && size && viewW && size.w !== viewW) {
      const k = size.w / viewW;
      rect = { x: rect.x * k, y: rect.y * k, width: rect.width * k, height: rect.height * k };
    }
    out.push({ n: Number(m[1]), kind: s.kind || "", status: s.status, caption, url: s.url, img, size, rect });
  }
  return out.sort((a, b) => a.n - b.n);
}

// Older loop.json files did not record which pack belongs to which entry:
// match by pack id and the closest time before the entry.
function findPack(out, entry) {
  if (entry.evidence && fs.existsSync(entry.evidence)) return entry.evidence;
  const dir = path.join(out, "evidence");
  if (!fs.existsSync(dir)) return null;
  const at = Date.parse(entry.at);
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(.+)-(\d+)\.evidence$/);
    if (!m || m[1] !== entry.pack) continue;
    const t = Number(m[2]);
    if (t <= at + 5000 && (!best || t > best.t)) best = { t, file: path.join(dir, f) };
  }
  return best && best.file;
}

const PHASE = { after: 'After “Reject”', before: "Before any choice", unknown: "During the visit" };

function trackerTable(result) {
  const rows = (result.trackerRequests || []).slice().sort((a, b) => ({ after: 0, before: 1, unknown: 2 }[a.phase] - { after: 0, before: 1, unknown: 2 }[b.phase]));
  if (!rows.length) return "";
  return `<div class="tw"><table class="t"><thead><tr><th>When</th><th>Tracker</th><th>Request</th><th class="num">Times</th><th>Visitor ID sent</th></tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.phase}"><td>${PHASE[r.phase]}</td><td>${esc(r.tracker)}${r.consentDenied ? ` <small>consent denied, not counted</small>` : r.loaderOnly ? ` <small>tag manager code only, not counted</small>` : ""}</td><td class="mono">${esc(r.method || "")} ${esc(r.url.replace(/^https?:\/\//, ""))}</td><td class="num">${r.count}</td><td class="mono">${esc((r.ids || []).map((i) => i.split(": ").pop()).join(", "))}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

// Zoom into the spot Kane clicked and outline it. Falls back to the whole shot.
function zoom(s) {
  if (!s.size || !s.rect || !s.rect.width) return `<img src="${s.img}" alt="">`;
  const W = Math.min(s.size.w, Math.round(s.size.w * 0.42)), H = Math.round(W * 9 / 16);
  const cx = s.rect.x + s.rect.width / 2, cy = s.rect.y + s.rect.height / 2;
  const x0 = Math.max(0, Math.min(s.size.w - W, cx - W / 2));
  const y0 = Math.max(0, Math.min(s.size.h - H, cy - H / 2));
  const pct = (v, of) => (v / of * 100).toFixed(3) + "%";
  return `<div class="zoom" style="aspect-ratio:${W}/${H}"><img src="${s.img}" alt="" style="width:${pct(s.size.w, W)};left:${pct(-x0, W)};top:${pct(-y0, H)}"><i style="left:${pct(s.rect.x - x0 - 6, W)};top:${pct(s.rect.y - y0 - 6, H)};width:${pct(s.rect.width + 12, W)};height:${pct(s.rect.height + 12, H)}"></i></div>`;
}

function shot(s, key, note) {
  if (!s || !s.img) return "";
  return `<figure><a href="#${key}-${s.n}" aria-label="Open Kane's full screenshot">${zoom(s)}</a><figcaption>Kane's screenshot, step ${s.n}: ${esc(s.caption)}. ${esc(note)}</figcaption></figure>`;
}

function filmstrip(list, id) {
  if (!list.length) return "";
  return `<ol class="strip">${list
    .map((s) => `<li>${s.img ? `<a href="#${id}-${s.n}"><img src="${s.img}" alt="Step ${s.n}: ${esc(s.caption)}" loading="lazy"></a>` : ""}<span><b>${s.n}</b> ${esc(s.caption)}</span></li>`)
    .join("")}</ol>${list
    .filter((s) => s.img)
    .map((s) => `<a class="lightbox" id="${id}-${s.n}" href="#_"><img src="${s.img}" alt=""><span>Step ${s.n} · ${esc(s.caption)}</span></a>`)
    .join("")}`;
}

function build({ out, packs, url = "" }) {
  const loopFile = path.join(out, "loop.json");
  let loop;
  if (fs.existsSync(loopFile)) {
    loop = JSON.parse(fs.readFileSync(loopFile, "utf8"));
  } else {
    // A single check, no loop: show the last run of each pack.
    const timeline = [];
    for (const id of Object.keys(packs)) {
      const f = path.join(out, `${id}.last-run.json`);
      if (!fs.existsSync(f)) continue;
      const last = JSON.parse(fs.readFileSync(f, "utf8"));
      timeline.push({ round: 1, step: "kane", pack: id, evidence: last.packPath, run: last.end && last.end.test_url, at: new Date().toISOString(), credits: last.end && last.end.credits_consumed, kaneStatus: last.end && last.end.status, kaneSummary: last.end && last.end.summary });
    }
    loop = { pack: timeline[0] && timeline[0].pack, timeline, url };
  }
  const main = packs[loop.pack] || Object.values(packs)[0];

  // Re-judge every Kane run from its sealed pack, so the page is always
  // derived from evidence rather than from saved text.
  const entries = loop.timeline.map((t, i) => {
    if (t.step !== "kane") return t;
    const packPath = findPack(out, t);
    const pk = packs[t.pack];
    let result = null;
    if (packPath && pk) {
      const network = evidence.networkFromPack(packPath);
      const end = t.kaneStatus ? { status: t.kaneStatus, summary: t.kaneSummary } : null;
      result = pk.judge({ end, events: [], network, strict: !!loop.strict });
      t.run = t.run || network.shareLink;
    }
    return { ...t, packPath, result, shots: steps(packPath), key: `r${i}` };
  });

  const kaneRuns = entries.filter((e) => e.step === "kane");
  const first = kaneRuns.find((e) => e.pack === main.id);
  const lastMain = [...kaneRuns].reverse().find((e) => e.pack === main.id);
  const fixed = !!lastMain && lastMain.result && lastMain.result.verdict === "pass" && first && first.result && first.result.verdict === "violation";
  const status = fixed ? "fixed" : lastMain && lastMain.result ? lastMain.result.verdict : "inconclusive";
  const afterCount = (r) => (r && r.trackerRequests ? r.trackerRequests.filter((x) => x.phase === "after").reduce((a, x) => a + x.count, 0) : 0);
  const ids = (first && first.result && first.result.idsAfterReject) || [];
  const rounds = Math.max(1, ...entries.map((e) => e.round || 1));
  const credits = loop.credits != null ? Number(loop.credits) : kaneRuns.reduce((a, e) => a + (Number(e.credits) || 0), 0);
  const agentEntry = entries.find((e) => e.step === "agent");

  const views = {
    consent: {
      headline: {
        fixed: "Kane caught a visitor being tracked after they clicked “Reject”. Claude Code fixed it. Kane proved the fix.",
        violation: "Kane caught a visitor being tracked after they refused cookies.",
        pass: "Kane refused cookies and no tracker followed.",
      },
      stat: () => [`${afterCount(first && first.result)} → ${afterCount(lastMain && lastMain.result)}`, "tracker requests after “Reject”"],
      exhibit: () => `
  <div class="ex-grid">
    <div>
      <p class="lead">${esc(first.result.why)}</p>
      ${ids.length ? `<div class="idbox"><span>Visitor ID sent to Google after “Reject”</span><code>${esc(ids[0].split(": ").pop())}</code><small>${esc(ids[0].split(": ")[0])}</small></div>` : ""}
      ${first.result.rejectClick ? `<p class="meta">Kane clicked “${esc(first.result.rejectClick.label)}” at <span class="mono">${esc((first.result.rejectClick.time || "").replace("T", " ").replace(/\.\d+Z$/, " UTC"))}</span>. Every request after that moment is counted as after the refusal.</p>` : ""}
    </div>
    ${shot(first.shots.find((x) => /reject|declin|refus/i.test(x.caption)) || first.shots[0], first.key, "The outline marks what it clicked.")}
  </div>
  ${trackerTable(first.result)}`,
    },
    cancel: {
      headline: {
        fixed: "Kane subscribed in a couple of clicks but could not cancel online. Claude Code fixed it. Kane proved cancelling is now as easy as signing up.",
        violation: "Kane subscribed in a couple of clicks but could not cancel the same way.",
        pass: "Kane cancelled the subscription online as easily as it signed up.",
      },
      stat: () => [`${first && first.result ? first.result.cancelClicks : "—"} → ${lastMain && lastMain.result ? lastMain.result.cancelClicks : "—"}`, `steps to cancel (signup: ${first && first.result ? first.result.signupClicks : "—"})`],
      exhibit: () => `
  <div class="ex-grid">
    <div>
      <p class="lead">${esc(first.result.why)}</p>
      <div class="paths">
        <div><h4>Subscribing · ${first.result.signup.length}</h4><ol>${first.result.signup.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
        <div class="bad"><h4>Cancelling · ${first.result.cancel.length}${first.result.confirmed ? "" : ", never confirmed"}</h4><ol>${first.result.cancel.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>No way found</li>"}</ol></div>
      </div>
    </div>
    ${shot(first.shots[first.shots.length - 1], first.key, "Where Kane's attempt to cancel ended.")}
  </div>`,
    },
  };
  const view = views[main.id] || views.consent;
  const headline = view.headline[status] || "This run could not prove anything either way.";
  const [statBig, statLabel] = view.stat();

  const exhibit = first && first.result && first.result.verdict === "violation" ? `
<section class="exhibit">
  <div class="label">Exhibit A · what Kane recorded</div>${view.exhibit()}
</section>` : "";

  const timeline = entries.map((e) => {
    if (e.step === "agent") {
      return `<li class="ev agent"><div class="who">Round ${e.round} · Claude Code</div><h3>Changed the app</h3><div class="prose">${md(e.summary)}</div></li>`;
    }
    const pk = packs[e.pack];
    const v = e.result ? e.result.verdict : e.verdict || "inconclusive";
    return `<li class="ev ${v}"><div class="who">Round ${e.round} · Kane · ${esc(pk ? pk.title : e.pack)}</div>
<h3><span class="pill ${v}">${v === "pass" ? "Proven" : v === "violation" ? "Violation" : "Inconclusive"}</span></h3>
<p>${esc(e.result ? e.result.why : e.why)}</p>
${filmstrip(e.shots, e.key)}
<p class="links">${e.run ? `<a href="${esc(e.run)}" target="_blank" rel="noopener">Open this run in TestMu Test Manager ↗</a>` : ""}${e.packPath ? `<span class="mono">${esc(path.basename(e.packPath))}</span>` : ""}</p></li>`;
  }).join("");

  const generated = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statute · ${esc(main.title)} · ${status === "fixed" ? "Fixed" : status}</title>
<style>
:root{--paper:#f6f4ee;--ink:#17171a;--mute:#6b6a66;--rule:#dcd8cc;--red:#b42318;--red-bg:#fbeae8;--green:#1f7a4d;--green-bg:#e6f3ec;--amber:#8a5a00;--card:#fffdf8}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:0 28px}
header.top{border-bottom:1px solid var(--rule)}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;height:60px;font-size:14px;color:var(--mute)}
.mark{font:600 19px/1 "Iowan Old Style","Palatino Linotype",Charter,Georgia,serif;color:var(--ink);letter-spacing:.01em}
.mark i{font-style:normal;color:var(--mute);font-weight:400;margin-left:10px;font-family:system-ui,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.mono,code{font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-size:.88em}
.hero{padding:56px 0 36px;border-bottom:1px solid var(--rule)}
.stamp{display:inline-block;border:2px solid currentColor;border-radius:4px;padding:4px 12px;font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;transform:rotate(-2deg)}
.stamp.fixed,.stamp.pass{color:var(--green)}.stamp.violation{color:var(--red)}.stamp.inconclusive{color:var(--amber)}
h1{font:500 clamp(34px,5vw,54px)/1.08 "Iowan Old Style","Palatino Linotype",Charter,Georgia,serif;margin:18px 0 14px;letter-spacing:-.01em}
.deck{font-size:20px;line-height:1.5;max-width:720px;margin:0;color:#2e2e33}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:36px;border-top:1px solid var(--rule)}
.stats div{padding:16px 0 0}.stats b{display:block;font:500 30px/1.1 "Iowan Old Style",Georgia,serif}.stats span{font-size:13px;color:var(--mute)}
.label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin-bottom:14px}
section{padding:44px 0;border-bottom:1px solid var(--rule)}
.ex-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
.lead{font-size:19px;margin:0 0 18px}
.idbox{background:var(--red-bg);border-left:3px solid var(--red);padding:14px 16px;margin:0 0 16px;border-radius:0 6px 6px 0}
.idbox span{display:block;font-size:13px;color:var(--red);font-weight:600}.idbox code{display:block;font-size:clamp(18px,5vw,24px);word-break:break-all;margin:4px 0;color:var(--ink)}.idbox small{color:var(--mute)}
.meta{font-size:14px;color:var(--mute)}
figure{margin:0}figure img{width:100%;border:1px solid var(--rule);border-radius:6px;display:block}
.zoom{position:relative;overflow:hidden;border:1px solid var(--rule);border-radius:6px;background:#fff}.zoom img{position:absolute;max-width:none;border:0;border-radius:0}
.zoom i{position:absolute;border:2px solid var(--red);border-radius:6px;box-shadow:0 0 0 9999px rgba(23,23,26,.16)}figcaption{font-size:13px;color:var(--mute);margin-top:8px}
.tw{overflow-x:auto;margin-top:28px;-webkit-overflow-scrolling:touch}table.t{width:100%;min-width:640px;border-collapse:collapse;font-size:14px}
.t th{text-align:left;font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);border-bottom:1px solid var(--ink);padding:8px 10px 8px 0}
.t td{border-bottom:1px solid var(--rule);padding:10px 10px 10px 0;vertical-align:top}.t .num{text-align:right}
.t tr.after td:first-child{color:var(--red);font-weight:600}
ol.timeline{list-style:none;margin:0;padding:0;position:relative}
ol.timeline:before{content:"";position:absolute;left:7px;top:8px;bottom:8px;width:1px;background:var(--rule)}
.ev{position:relative;padding:0 0 36px 40px}
.ev:before{content:"";position:absolute;left:0;top:6px;width:15px;height:15px;border-radius:50%;background:var(--paper);border:2px solid var(--mute)}
.ev.violation:before{border-color:var(--red);background:var(--red)}.ev.pass:before{border-color:var(--green);background:var(--green)}.ev.agent:before{border-color:var(--ink);background:var(--card)}
.who{font-size:13px;color:var(--mute)}
.ev h3{margin:4px 0 8px;font:500 22px/1.3 "Iowan Old Style",Georgia,serif}
.pill{display:inline-block;font:600 12px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:6px 10px;border-radius:999px}
.pill.violation{background:var(--red-bg);color:var(--red)}.pill.pass{background:var(--green-bg);color:var(--green)}.pill.inconclusive{background:#f6ecd6;color:var(--amber)}
.prose{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:4px 18px;max-width:760px}.prose code{background:#efece3;padding:1px 5px;border-radius:4px}
ol.strip{list-style:none;padding:0;margin:14px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.strip img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid var(--rule);border-radius:4px;display:block;background:#fff}
.strip span{display:block;font-size:12px;color:var(--mute);margin-top:6px;line-height:1.35}.strip b{color:var(--ink)}
.links{font-size:14px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}.links a{color:var(--ink)}.links .mono{color:var(--mute)}
.lightbox{display:none;position:fixed;inset:0;background:rgba(23,23,26,.88);z-index:10;padding:4vh 4vw;text-decoration:none;flex-direction:column;align-items:center;justify-content:center}
.lightbox:target{display:flex}.lightbox img{max-width:100%;max-height:84vh;border-radius:6px;background:#fff}.lightbox span{color:#fff;margin-top:12px;font-size:14px}
.paths{display:grid;grid-template-columns:1fr 1fr;gap:16px}.paths h4{margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--green)}.paths .bad h4{color:var(--red)}.paths ol{margin:0;padding-left:20px;font-size:14px}.paths li{margin-bottom:4px}
.law{display:grid;grid-template-columns:1fr 1fr;gap:32px}.law ul{margin:0;padding-left:18px}.law li{margin-bottom:10px}
footer{padding:28px 0 48px;font-size:13px;color:var(--mute)}
a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
@media (max-width:760px){.ex-grid,.law,.paths{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.t{font-size:13px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body>
<header class="top"><div class="wrap"><div class="mark">Statute<i>Case file</i></div><div>${esc(loop.url || "")}</div></div></header>
<main class="wrap">
<div class="hero">
  <span class="stamp ${status}">${status === "fixed" ? "Fixed and proven" : status === "pass" ? "Proven" : status === "violation" ? "Violation" : "Inconclusive"}</span>
  <h1>${esc(main.title)}</h1>
  <p class="deck">${esc(headline)}</p>
  <div class="stats">
    <div><b>${esc(statBig)}</b><span>${esc(statLabel)}</span></div>
    <div><b>${rounds}</b><span>round${rounds === 1 ? "" : "s"}</span></div>
    <div><b>${kaneRuns.length}</b><span>Kane runs in a real browser</span></div>
    <div><b>${credits ? credits.toFixed(1) : "—"}</b><span>Kane credits</span></div>
  </div>
</div>
${exhibit}
<section>
  <div class="label">What happened</div>
  <ol class="timeline">${timeline}</ol>
</section>
<section class="law">
  <div><div class="label">The rule</div><p class="lead">${esc(main.rule)}</p></div>
  <div><div class="label">Why it matters</div><ul>${main.laws.map((l) => `<li><strong>${esc(l.ref)}</strong>: ${esc(l.gist)}</li>`).join("")}</ul></div>
</section>
</main>
<footer><div class="wrap">Evidence, not legal advice. Every verdict on this page is computed by code from Kane CLI's sealed evidence packs. Generated ${generated}.</div></footer>
</body></html>`;
  const file = path.join(out, "index.html");
  fs.writeFileSync(file, html);
  return file;
}

module.exports = { build };
