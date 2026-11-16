// Builds statute-report/index.html: a self-contained case file of what Kane
// caught, what the agent changed, and what Kane proved. Pure code, no AI.
const fs = require("fs");
const path = require("path");
const zip = require("./zip");
const evidence = require("./evidence");

// The site's fonts, built into each case file so it looks the same offline.
const fontB64 = (f) => { try { return fs.readFileSync(path.join(__dirname, "..", "site", "assets", "fonts", f)).toString("base64"); } catch { return ""; } };
const FONT_SERIF = fontB64("instrument-serif.woff2");
const FONT_SANS = fontB64("geist.woff2");

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
  // Every counted tracker request made without consent: after Reject, or before any choice.
  const afterCount = (r) => (r && r.trackerRequests ? r.trackerRequests.filter((x) => !x.notCounted).reduce((a, x) => a + x.count, 0) : 0);
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
      stat: () => [`${afterCount(first && first.result)} → ${afterCount(lastMain && lastMain.result)}`, "tracker requests without consent"],
      exhibit: () => `
  <div class="ex-grid">
    <div>
      <p class="lead">${esc(first.result.why)}</p>
      ${ids.length ? `<div class="idbox"><span>Visitor ID sent to Google after “Reject”</span><code>${esc(ids[0].split(": ").pop())}</code><small>${esc(ids[0].split(": ")[0])}</small></div>` : ""}
      ${first.result.rejectClick ? `<p class="meta">Kane clicked “${esc(first.result.rejectClick.label)}” at <span class="mono">${esc((first.result.rejectClick.time || "").replace("T", " ").replace(/\.\d+Z$/, " UTC"))}</span>. Every request after that moment is counted as after the refusal.</p>` : ""}
    </div>
    ${shot(first.shots.find((x) => /reject|declin|refus/i.test(x.caption)) || first.shots[first.shots.length - 1], first.key, "The outline marks what it clicked.")}
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
    price: {
      headline: {
        fixed: "Kane found a fee that only appeared at checkout. Claude Code fixed it. Kane proved the shopper now pays the price they were shown.",
        violation: "Kane found a fee that only appeared at checkout.",
        pass: "Kane paid the price it was shown, apart from shipping and tax.",
      },
      stat: () => {
        const e = (r) => (r && r.extra != null ? r.extra.toFixed(2) : "—");
        return [`${e(first && first.result)} → ${e(lastMain && lastMain.result)}`, "added at checkout beyond the shown price"];
      },
      exhibit: () => `
  <div class="ex-grid">
    <div>
      <p class="lead">${esc(first.result.why)}</p>
      <div class="paths">
        <div><h4>Shown on the product page</h4><ol><li class="mono">${esc((first.result.readings || {}).product_price || "—")}</li></ol></div>
        <div class="bad"><h4>Total at checkout</h4><ol><li class="mono">${esc((first.result.readings || {}).checkout_total || "—")}</li>${first.result.shipping ? `<li>shipping ${first.result.shipping.toFixed(2)}</li>` : ""}${first.result.tax ? `<li>tax ${first.result.tax.toFixed(2)}</li>` : ""}</ol></div>
      </div>
    </div>
    ${shot(first.shots[first.shots.length - 1], first.key, "The checkout page Kane read the total from.")}
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
@font-face{font-family:IS;src:url(data:font/woff2;base64,${FONT_SERIF}) format("woff2")}
@font-face{font-family:GS;src:url(data:font/woff2;base64,${FONT_SANS}) format("woff2");font-weight:100 900}
:root{--bg:#000;--panel:#0b0b0b;--panel2:#141414;--line:rgba(255,255,255,.09);--ink:#fff;--soft:rgba(255,255,255,.66);--mute:rgba(255,255,255,.42);--red:#ff6159;--red-bg:rgba(255,97,89,.12);--green:#5fe3a7;--green-bg:rgba(95,227,167,.12);--amber:#f2c66d;--serif:IS,Georgia,serif;--sans:GS,system-ui,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(60% 40% at 50% 0%,rgba(95,227,167,.10),transparent 70%)}
.wrap{max-width:1080px;margin:0 auto;padding:0 clamp(18px,4vw,32px);position:relative}
header.top{border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;background:rgba(0,0,0,.7);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:60px;font-size:13px;color:var(--mute)}
header.top .wrap>div:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.mark{font:400 24px/1 var(--serif);color:var(--ink);display:flex;align-items:center;gap:10px}
.mark i{font:500 11px var(--sans);font-style:normal;color:var(--mute);padding:5px 10px;border:1px solid var(--line);border-radius:999px}
.mono,code{font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-size:.86em}
.hero{padding:clamp(48px,8vw,88px) 0 40px;border-bottom:1px solid var(--line)}
.stamp{display:inline-flex;align-items:center;gap:8px;padding:7px 16px;border-radius:999px;font:400 20px/1 var(--serif);font-style:italic;border:1px solid currentColor;animation:land .9s cubic-bezier(.22,1,.36,1) both}
.stamp:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 12px currentColor}
.stamp.fixed,.stamp.pass{color:var(--green);background:var(--green-bg);box-shadow:0 0 40px rgba(95,227,167,.18)}
.stamp.violation{color:var(--red);background:var(--red-bg);box-shadow:0 0 40px rgba(255,97,89,.18)}.stamp.inconclusive{color:var(--amber)}
@keyframes land{from{opacity:0;transform:scale(1.4);filter:blur(10px)}to{opacity:1;transform:none;filter:none}}
h1{font:400 clamp(44px,7vw,84px)/1 var(--serif);margin:22px 0 16px;letter-spacing:-.02em}
.deck{font-size:clamp(17px,2vw,21px);line-height:1.5;max-width:760px;margin:0;color:var(--soft)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:40px}
.stats div{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px 20px}
.stats b{display:block;font:400 clamp(26px,4vw,44px)/1.05 var(--serif);font-variant-numeric:tabular-nums;white-space:nowrap}
.stats div:first-child b{color:var(--green)}.stats span{font-size:13px;color:var(--mute)}
.label{display:inline-block;font-size:12px;color:var(--soft);padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.04);margin-bottom:22px}
section{padding:clamp(44px,7vw,72px) 0;border-bottom:1px solid var(--line)}
.exhibit{position:relative}
.ex-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:clamp(20px,4vw,40px);align-items:start}
.lead{font:400 clamp(22px,2.6vw,30px)/1.25 var(--serif);margin:0 0 20px}
.idbox{background:var(--red-bg);border:1px solid rgba(255,97,89,.35);padding:16px 18px;margin:0 0 18px;border-radius:16px}
.idbox span{display:block;font-size:13px;color:var(--red)}.idbox code{display:block;font-size:clamp(18px,4.6vw,26px);word-break:break-all;margin:6px 0;color:var(--ink)}.idbox small{color:var(--mute)}
.meta{font-size:14px;color:var(--mute)}
figure{margin:0}figure img{width:100%;border:1px solid var(--line);border-radius:14px;display:block}
.zoom{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:#111}.zoom img{position:absolute;max-width:none;border:0;border-radius:0}
.zoom i{position:absolute;border:2px solid var(--red);border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.35),0 0 24px rgba(255,97,89,.6)}
figcaption{font-size:13px;color:var(--mute);margin-top:10px}
.tw{overflow-x:auto;margin-top:32px;-webkit-overflow-scrolling:touch;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:6px 18px}
table.t{width:100%;min-width:640px;border-collapse:collapse;font-size:14px}
.t th{text-align:left;font-weight:500;font-size:12px;color:var(--mute);border-bottom:1px solid var(--line);padding:12px 12px 12px 0}
.t td{border-bottom:1px solid var(--line);padding:12px 12px 12px 0;vertical-align:top;color:var(--soft)}.t tr:last-child td{border-bottom:0}.t .num{text-align:right;color:var(--ink)}
.t tr.after td:first-child{color:var(--red)}.t tr.before td:first-child{color:var(--amber)}.t small{color:var(--mute)}
ol.timeline{list-style:none;margin:0;padding:0;position:relative}
ol.timeline:before{content:"";position:absolute;left:8px;top:10px;bottom:10px;width:1px;background:linear-gradient(var(--red),var(--line) 40%,var(--green))}
.ev{position:relative;padding:0 0 40px 44px}
.ev:before{content:"";position:absolute;left:0;top:6px;width:17px;height:17px;border-radius:50%;background:var(--bg);border:2px solid var(--mute)}
.ev.violation:before{border-color:var(--red);background:var(--red);box-shadow:0 0 16px rgba(255,97,89,.6)}
.ev.pass:before{border-color:var(--green);background:var(--green);box-shadow:0 0 16px rgba(95,227,167,.6)}
.ev.agent:before{border-color:var(--ink);background:var(--panel2)}
.who{font-size:13px;color:var(--mute)}
.ev h3{margin:6px 0 10px;font:400 28px/1.15 var(--serif)}
.pill{display:inline-block;font:500 12px/1 var(--sans);padding:7px 12px;border-radius:999px}
.pill.violation{background:var(--red-bg);color:var(--red)}.pill.pass{background:var(--green-bg);color:var(--green)}.pill.inconclusive{background:rgba(242,198,109,.12);color:var(--amber)}
.ev p{color:var(--soft)}
.prose{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:6px 20px;max-width:780px;color:var(--soft)}.prose code{background:rgba(255,255,255,.08);padding:1px 6px;border-radius:5px;color:var(--ink)}.prose strong{color:var(--ink)}
ol.strip{list-style:none;padding:0;margin:16px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.strip a{display:block;text-decoration:none;transition:transform .3s}.strip a:hover{transform:translateY(-2px)}
.strip img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:10px;display:block;background:#111}
.strip span{display:block;font-size:12px;color:var(--mute);margin-top:7px;line-height:1.35}.strip b{color:var(--soft);font-weight:500}
.links{font-size:14px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}.links a{color:var(--ink);text-underline-offset:4px;text-decoration-color:rgba(255,255,255,.3)}.links .mono{color:var(--mute)}
.lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10;padding:4vh 4vw;text-decoration:none;flex-direction:column;align-items:center;justify-content:center}
.lightbox:target{display:flex}.lightbox img{max-width:100%;max-height:84vh;border-radius:12px;background:#111}.lightbox span{color:var(--soft);margin-top:14px;font-size:14px}
.paths{display:grid;grid-template-columns:1fr 1fr;gap:12px}.paths>div{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.paths h4{margin:0 0 8px;font:500 13px var(--sans);color:var(--green)}.paths .bad h4{color:var(--red)}.paths ol{margin:0;padding-left:20px;font-size:14px;color:var(--soft)}.paths li{margin-bottom:4px}
.law{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,4vw,40px)}.law ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.law li{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;color:var(--soft);font-size:15px}.law li strong{display:block;color:var(--ink);font-weight:500;margin-bottom:2px}
footer{padding:32px 0 56px;font-size:13px;color:var(--mute)}footer a{color:var(--soft)}
a{color:var(--green)}a:focus-visible{outline:2px solid var(--green);outline-offset:2px}
@media (max-width:760px){.ex-grid,.law,.paths{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.t{font-size:13px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto}}
</style></head><body>
<header class="top"><div class="wrap"><div class="mark">Statute<i>Case file</i></div><div title="${esc(loop.url || "")}">${esc(loop.title ? loop.title.split(":")[0] : loop.url || "")}</div></div></header>
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
<footer><div class="wrap">Evidence, not legal advice. Every verdict on this page is computed by code from Kane CLI's sealed evidence packs. Generated ${generated}. <a href="https://statute-production.up.railway.app">Statute</a></div></footer>
</body></html>`;
  const file = path.join(out, "index.html");
  fs.writeFileSync(file, html);
  return file;
}

module.exports = { build };
