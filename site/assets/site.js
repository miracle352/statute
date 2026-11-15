(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* nav + menu + copy */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("solid", scrollY > 16);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const menuBtn = $("#menuBtn"), sheet = $("#sheet");
  const setMenu = (open) => {
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    sheet.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  };
  menuBtn.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
  $$("#sheet a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) { setMenu(false); menuBtn.focus(); } });
  $$(".copy").forEach((b) => b.addEventListener("click", async () => {
    const label = b.firstChild;
    try { await navigator.clipboard.writeText(b.dataset.copy); label.textContent = "Copied"; } catch { label.textContent = "Select it"; }
    setTimeout(() => (label.textContent = "Copy"), 1600);
  }));

  /* ---------- console ---------- */
  const screen = $("#screen"), cap = $("#screenCap"), feed = $("#feed"), count = $("#feedCount");
  const verdict = $("#verdict"), pill = $("#verdictPill"), vtext = $("#verdictText"), vlink = $("#verdictLink");
  const urlLabel = $("#consoleUrl"), mode = $("#consoleMode");
  let requests = 0;
  let session = 0; // bumps when a live audit takes over, so the replay stops

  function line(html, cls) {
    const li = document.createElement("li");
    if (cls) li.className = cls;
    li.innerHTML = html;
    feed.appendChild(li);
    while (feed.children.length > 40) feed.firstChild.remove();
  }
  function request(r) {
    requests++;
    count.textContent = `${requests} request${requests === 1 ? "" : "s"}`;
    const kind = r.tracker ? (r.after ? "tracker, after Reject" : "tracker") : "";
    line(`<span class="m">${esc(r.method)}</span><span class="u">${esc(r.url)}</span><span class="k">${kind}</span>`, r.tracker ? `tr ${r.after ? "after" : "before"}` : "");
  }
  function show(src, caption) {
    if (caption) cap.textContent = caption;
    if (!src || screen.getAttribute("src") === src) return;
    screen.classList.add("swap");
    const img = new Image();
    img.onload = () => { screen.src = src; screen.classList.remove("swap"); };
    img.src = src;
  }
  function setVerdict(state, text, href) {
    verdict.dataset.state = state;
    pill.textContent = { idle: "Watching", running: "Running", violation: "Violation", pass: "Passed", inconclusive: "Inconclusive", error: "Stopped" }[state] || state;
    vtext.innerHTML = text;
    vlink.hidden = !href;
    if (href) vlink.href = href;
  }
  function reset(label, modeText, live) {
    feed.innerHTML = "";
    requests = 0;
    count.textContent = "0 requests";
    urlLabel.textContent = label;
    mode.textContent = modeText;
    mode.classList.toggle("live", !!live);
  }

  /* idle: replay of a real recorded Kane run */
  const R = window.REPLAY;
  async function replay(my) {
    const alive = () => my === session;
    for (;;) {
      if (!alive()) return;
      reset("Lumen demo shop", "Recorded run");
      setVerdict("idle", "Kane opens the shop as a new visitor. The cookie banner is showing.");
      show(R.steps[0].img, "Kane opens the shop");
      const shots = R.steps;
      let shot = 1, marked = false, afterTr = 0;
      for (const r of R.run1) {
        if (!alive()) return;
        if (r.after && !marked) {
          marked = true;
          show(shots[1].img, "Kane clicks “Reject all”");
          line("Kane clicks “Reject all”", "mark");
          setVerdict("running", "Visitor refused cookies. Watching what still loads.");
          await sleep(1600);
        }
        const isPage = /^localhost:4173\/(product|cart|account)/.test(r.u) || (r.after && r.u === "localhost:4173/");
        if (marked && isPage && shot < shots.length - 1) { shot++; show(shots[shot].img, shots[shot].caption); }
        request({ method: r.m, url: r.u, tracker: r.tr, after: r.after });
        if (r.tr && r.after) { afterTr++; setVerdict("running", `<strong>${afterTr}</strong> tracker request${afterTr === 1 ? "" : "s"} after Reject`); }
        await sleep(r.tr ? 520 : 260);
      }
      if (!alive()) return;
      const id = (R.run1.find((r) => r.id) || {}).id;
      setVerdict("violation", `${afterTr} tracker requests after Reject. Google Analytics kept receiving visitor ID <code>${esc(id)}</code>.`, "cases/reject-means-reject.html");
      await sleep(5200);
      if (!alive()) return;
      line("Claude Code moves the tags behind consent", "fix");
      setVerdict("running", "On the next run, after Claude Code's fix:");
      await sleep(1800);
      if (!alive()) return;
      setVerdict("pass", "Kane refused cookies again and recorded 17 requests. None went to a tracker.", "cases/reject-means-reject.html");
      await sleep(5200);
    }
  }
  if (reduce) {
    reset("Lumen demo shop", "Recorded run");
    R.run1.slice(-10).forEach((r) => request({ method: r.m, url: r.u, tracker: r.tr, after: r.after }));
    show(R.steps[1].img, "Kane clicks “Reject all”");
    setVerdict("violation", "8 tracker requests after Reject, fixed by Claude Code and proven by Kane on the next run.", "cases/reject-means-reject.html");
  } else replay(session);

  /* ---------- live audits ---------- */
  const form = $("#auditForm"), input = $("#urlInput"), own = $("#ownBox"), msg = $("#formMsg"), runBtn = $("#runBtn"), demoBtn = $("#demoBtn"), quota = $("#quota");
  let es = null;

  async function refreshQuota() {
    try {
      const s = await (await fetch("/api/status", { cache: "no-store" })).json();
      quota.textContent = `${s.left} of ${s.dailyCap} live audits left today${s.running ? ". Kane is running an audit now" : ""}${s.queue ? `, ${s.queue} waiting` : ""}.`;
      return true;
    } catch { quota.textContent = ""; return false; }
  }
  refreshQuota();

  function say(text, err) { msg.textContent = text; msg.classList.toggle("err", !!err); }
  function busy(on) { runBtn.disabled = on; demoBtn.disabled = on; runBtn.textContent = on ? "Kane is running" : "Audit with Kane"; }

  async function start(body, label) {
    say("");
    busy(true);
    let r;
    try {
      const res = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      r = await res.json();
      if (!res.ok) { say(r.error || "The audit could not start.", true); busy(false); return; }
    } catch {
      say("Live audits need the Statute server, and this copy of the site can't reach it. Run it yourself with npm start, or use the hosted site.", true);
      busy(false);
      return;
    }
    session++;
    document.getElementById("console").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    reset(label, r.cached ? "Saved result from the last 24 hours" : "Connecting", !r.cached);
    setVerdict("running", r.cached ? "Loading the saved audit." : "Starting a real Chrome for Kane.");
    cap.textContent = "Waiting for Kane";
    follow(r.id, !!r.cached);
  }

  function follow(id, cached) {
    if (es) es.close();
    es = new EventSource(`/api/audit/${id}/stream`);
    let rejectAt = null;
    es.addEventListener("queued", (e) => {
      const d = JSON.parse(e.data);
      if (d.position > 1) setVerdict("running", `In line: position ${d.position}. Kane runs one audit at a time.`);
    });
    es.addEventListener("started", () => { if (!cached) mode.textContent = "Live"; setVerdict("running", "Kane is opening the site in a real browser."); });
    es.addEventListener("frame", (e) => { const d = JSON.parse(e.data); show(`data:image/jpeg;base64,${d.data}`); });
    es.addEventListener("step", (e) => {
      const d = JSON.parse(e.data);
      if (d.status !== "done") return;
      const text = d.remark.replace(/^\w+:\s*/, "");
      cap.textContent = text;
      line(esc(text), "step");
    });
    es.addEventListener("reject", (e) => {
      const d = JSON.parse(e.data);
      rejectAt = d.at;
      line(`Kane clicks “${esc(d.label || "Reject")}”`, "mark");
      setVerdict("running", "Visitor refused cookies. Watching what still loads.");
    });
    es.addEventListener("request", (e) => request(JSON.parse(e.data)));
    es.addEventListener("verdict", (e) => {
      const d = JSON.parse(e.data);
      setVerdict(d.verdict, esc(d.why), d.caseUrl);
      mode.textContent = cached ? "Saved result" : "Finished";
      mode.classList.remove("live");
      busy(false); es.close(); refreshQuota();
    });
    es.addEventListener("error", (e) => {
      if (e.data) { const d = JSON.parse(e.data); setVerdict("error", esc(d.message)); }
      else if (verdict.dataset.state === "running") setVerdict("error", "The connection to the audit dropped. Reload to see the saved result.");
      mode.classList.remove("live");
      busy(false); es.close(); refreshQuota();
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = input.value.trim().replace(/^https?:\/\//i, "");
    if (!url) { say("Enter your site's address first.", true); input.focus(); return; }
    if (!own.checked) { say("Tick the box to confirm you own this site or may test it.", true); own.focus(); return; }
    start({ url, pack: "consent", confirm: true }, `https://${url}`);
  });
  input.addEventListener("input", () => say(""));
  own.addEventListener("change", () => say(""));
  demoBtn.addEventListener("click", () => start({ demo: true, pack: "consent" }, "Lumen demo shop"));

  /* ---------- terminal: replay of a real demo:fix run ---------- */
  const TERM = [
    ["prompt", "$ npm run demo:fix"], ["", ""],
    ["", "Statute · Reject means reject"],
    ["dim", "Kane is visiting http://localhost:4173..."],
    ["dim", "  step 2 done: click: Rejecting all cookies in the cookie banner"],
    ["dim", "  step 3 done: click: Clicking View product on the first product card"],
    ["bad", "VIOLATION: Kane recorded 8 tracker requests after the visitor clicked \"Reject\", 3 before they had chosen anything."],
    ["bad", "  · visitor ID sent after Reject: 1522666046.1794751354"], ["", ""],
    ["", "Handing the report to Claude Code (round 1)..."],
    ["", "  claude │ What was wrong: public/tags.js loaded GA4 and the Meta pixel on every page without checking for consent."],
    ["", "  claude │ What I changed: the tags load only when consent=accepted; Accept calls loadTags()."], ["", ""],
    ["good", "PASS: Kane refused cookies and recorded 17 requests; none went to a known tracker."],
    ["good", "PASS: After \"Accept\", the tags loaded as intended."], ["", ""],
    ["good", "DONE in 2 round(s). Credits used: 30.7"],
    ["dim", "Case file: statute-report/index.html"],
  ];
  const term = $("#term");
  const tl = ([c, s]) => `<span class="${c}">${esc(s)}</span>\n`;
  if (reduce) term.innerHTML = TERM.map(tl).join("");
  else {
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const [c0, cmd] = TERM[0];
      for (let i = 1; i <= cmd.length; i++) { term.innerHTML = `<span class="${c0}">${esc(cmd.slice(0, i))}</span><span class="caret"></span>`; await sleep(45); }
      let html = tl(TERM[0]);
      for (const l of TERM.slice(1)) { await sleep(l[1] === "" ? 120 : l[0] === "dim" ? 260 : 480); html += tl(l); term.innerHTML = html + '<span class="caret"></span>'; }
    }, { threshold: 0.3 });
    io.observe(term);
  }
})();
