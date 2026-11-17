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
    try { const from = b.dataset.copyFrom && document.getElementById(b.dataset.copyFrom); await navigator.clipboard.writeText(from ? from.textContent : b.dataset.copy); label.textContent = "Copied"; } catch { label.textContent = "Select it"; }
    setTimeout(() => (label.textContent = "Copy"), 1600);
  }));


  /* ---------- motion ---------- */
  const revealer = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); } }), { threshold: .15, rootMargin: "0px 0px -6% 0px" });
  $$("[data-split]").forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = words.map((w, i) => `<span class="w" aria-hidden="true" style="--i:${i}">${esc(w)}</span>`).join(" ");
  });
  $$(".hero .reveal, .hero [data-split]").forEach((el, i) => setTimeout(() => el.classList.add("in"), 80 + i * 90));
  $$(".reveal, [data-split], .stats-art").forEach((el) => { if (!el.closest(".hero")) revealer.observe(el); });
  if (reduce) $$(".reveal, [data-split]").forEach((el) => el.classList.add("in"));

  // rolling digits: each digit is a column of 0-9 that slides into place
  const rollTargets = {};
  function buildRoll(el, value) {
    const str = Number(value).toLocaleString("en-US");
    el.setAttribute("aria-label", str);
    el.dataset.v = str;
    el.innerHTML = [...str].map((ch, i) => /\d/.test(ch)
      ? `<span class="col" aria-hidden="true" style="--i:${i}">${"0123456789".split("").map((d) => `<span>${d}</span>`).join("")}</span>`
      : `<span aria-hidden="true">${ch}</span>`).join("");
    const go = () => el.dataset.v === str && [...el.querySelectorAll(".col")].forEach((c, k) => {
      const digit = str.replace(/[^\d]/g, "")[k];
      c.style.transform = `translateY(-${digit}em)`;
    });
    if (reduce) { go(); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); requestAnimationFrame(() => requestAnimationFrame(go)); } }, { threshold: .4 });
    io.observe(el);
  }
  function setRoll(key, value) { const el = $(`[data-roll="${key}"]`); if (el) buildRoll(el, value); }
  $$("[data-roll]").forEach((el) => buildRoll(el, 0));

  // accordion
  $$(".acc-item").forEach((item) => {
    const head = $(".acc-head", item);
    head.addEventListener("click", () => {
      const open = !item.classList.contains("open");
      $$(".acc-item").forEach((o) => { o.classList.remove("open"); $(".acc-head", o).setAttribute("aria-expanded", "false"); });
      if (open) { item.classList.add("open"); head.setAttribute("aria-expanded", "true"); }
    });
  });

  // hero terrain: a field of points rolling like dunes, drawn in perspective
  (() => {
    const cv = $("#terrain"); if (!cv) return;
    const ctx = cv.getContext("2d");
    let W = 0, H = 0, dpr = 1, raf = 0, t = 0, visible = true;
    let formBottom = 0;
    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = $("#auditForm"); formBottom = f ? f.getBoundingClientRect().bottom - cv.getBoundingClientRect().top : 0;
    };
    const COLS = innerWidth < 700 ? 110 : 220, ROWS = innerWidth < 700 ? 42 : 64;
    function height(x, z, t) {
      return Math.sin(x * 2.1 + t * .5) * .45 + Math.sin(z * 3.3 - t * .35) * .35 + Math.sin((x + z) * 5.2 + t * .8) * .12 + Math.cos(x * 7 - z * 2 + t) * .05;
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const top = Math.min(H * .9, Math.max(H * (W < 700 ? .72 : .62), formBottom + 24));
      for (let r = 0; r < ROWS; r++) {
        const k = r / (ROWS - 1);               // 0 = far (top), 1 = near (bottom)
        const yRow = top + Math.pow(k, 1.55) * (H - top + 40);
        const amp = (14 + k * 120) * (H / 900);
        const spread = .55 + k * 1.1;            // rows widen as they come closer
        for (let c = 0; c < COLS; c++) {
          const x = c / (COLS - 1) - .5;
          const h = height(x * 2.4, k * 2.2 - t * .05, t);
          const px = W / 2 + x * W * spread;
          if (px < -6 || px > W + 6) continue;
          const py = yRow - (h + .5) * amp;
          const lum = Math.max(0, Math.min(1, (h + .7) / 1.5));
          const a = Math.min(1, (.12 + k * 1.1) * (.2 + lum * .95));
          if (a < .03) continue;
          ctx.fillStyle = `rgba(${60 + lum * 80 | 0},${150 + lum * 105 | 0},${100 + lum * 50 | 0},${a})`;
          const sz = (.8 + k * 1.8) * (.6 + lum * .9);
          ctx.fillRect(px, py, sz, sz);
        }
      }
    }
    function loop() { if (!visible) { raf = 0; return; } t += .012; frame(); raf = requestAnimationFrame(loop); }
    size(); frame();
    addEventListener("resize", () => { size(); frame(); });
    if (reduce) return;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) loop(); }).observe(cv);
    loop();
  })();

  /* ---------- console ---------- */
  const screen = $("#screen"), cap = $("#screenCap"), feed = $("#feed"), count = $("#feedCount");
  const verdict = $("#verdict"), pill = $("#verdictPill"), vtext = $("#verdictText"), vlink = $("#verdictLink");
  const urlLabel = $("#consoleUrl"), mode = $("#consoleMode");
  const stamp = $("#stamp"), stampWord = $("#stampWord"), consoleEl = $("#console"), fig = screen.parentElement;
  function slam(kind) {
    stamp.classList.remove("on", "pass");
    if (!kind) return;
    stampWord.textContent = kind === "pass" ? "Proven" : "Violation";
    stamp.classList.toggle("pass", kind === "pass");
    void stamp.offsetWidth;
    stamp.classList.add("on");
    if (kind !== "pass" && !reduce) { consoleEl.classList.remove("shake"); void consoleEl.offsetWidth; consoleEl.classList.add("shake"); }
  }
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
    fig.classList.remove("waiting");
    if (!screen.getAttribute("src")) { screen.src = src; return; }
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
    if (state === "violation" || state === "pass") slam(state); else slam(null);
    const fixit = $("#fixit");
    if (fixit) {
      // Shown once a violation appears; stays through the fix, hidden when a new audit starts.
      if (state === "violation") fixit.hidden = false;
      const target = /localhost|127\.0\.0\.1|demo shop/i.test(urlLabel.textContent) ? "http://localhost:3000" : urlLabel.textContent.trim();
      const c2 = $("#fixCmd2"); if (c2) c2.textContent = `Check consent on ${target} with statute and fix what it finds.`;
    }
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
      let shot = 0, marked = false, afterTr = 0;
      for (const r of R.run) {
        if (!alive()) return;
        if (r.after && !marked) {
          marked = true;
          shot = 2; show(shots[2].img, shots[2].caption);
          line("Kane clicks “Reject all”", "mark");
          setVerdict("running", "Visitor refused cookies. Watching what still loads.");
          await sleep(1600);
        }
        const isPage = r.after && /\/demo\/[a-z]/.test(r.u) && !/\.(js|css|jpg|png)$/.test(r.u);
        if (marked && isPage && shot < shots.length - 1) { shot++; show(shots[shot].img, shots[shot].caption); }
        request({ method: r.m, url: r.u, tracker: r.tr, after: r.after });
        if (!marked && r.tr && shot === 0) { await sleep(900); shot = 1; show(shots[1].img, shots[1].caption); }
        if (r.tr && r.after) { afterTr++; setVerdict("running", `<strong>${afterTr}</strong> tracker request${afterTr === 1 ? "" : "s"} after Reject`); }
        await sleep(r.tr ? 520 : 260);
      }
      if (!alive()) return;
      const id = (R.ids && R.ids[0]) || (R.run.find((r) => r.id && r.after) || {}).id;
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
    R.run.slice(-10).forEach((r) => request({ method: r.m, url: r.u, tracker: r.tr, after: r.after }));
    show(R.steps[2].img, R.steps[2].caption);
    setVerdict("violation", "5 tracker requests after Reject, fixed by Claude Code and proven by Kane on the next run.", "cases/reject-means-reject.html");
  } else replay(session);

  /* ---------- live audits ---------- */
  const form = $("#auditForm"), input = $("#urlInput"), own = $("#ownBox"), msg = $("#formMsg"), runBtn = $("#runBtn"), demoBtn = $("#demoBtn"), quota = $("#quota");
  let es = null, last = null;
  // A judges' link carries ?key=..., which lets live runs skip the daily caps.
  const KEY = new URLSearchParams(location.search).get("key") || undefined;

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
    { const fx = $("#fixit"); if (fx) fx.hidden = true; } // a new live audit starts clean
    body = { ...body, key: KEY };
    last = { body, label };
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
    screen.removeAttribute("src");
    screen.alt = "Waiting for the first frame from Kane's browser";
    fig.dataset.wait = r.cached ? "Loading the saved audit" : body.country ? "Kane is using a TestMu AI cloud browser in Germany. The cloud has no live view: Kane's verdict and screenshots arrive when it finishes, in about two minutes" : "Starting a real Chrome for Kane";
    fig.classList.add("waiting");
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
      if (d.position > 1) setVerdict("running", `In line: position ${d.position}, about ${d.ahead || 2} minutes. Kane runs one audit at a time, so every run is clean.`);
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
      if (d.verdict === "inconclusive" && /location/i.test(d.why || "") && last && !last.body.country && !last.body.demo) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "linkish eu-retry"; b.textContent = "Try again as a visitor in Germany, with a TestMu AI cloud browser";
        b.addEventListener("click", () => start({ ...last.body, country: "DE" }, `${last.label} (visitor in Germany)`));
        vtext.append(" ", b);
      }
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
  // The bar already shows https://, so drop a scheme the visitor types or pastes.
  const stripScheme = () => {
    const v = input.value, clean = v.replace(/^\s*https?:\/\/\s*/i, "");
    if (clean !== v) { input.value = clean; input.setSelectionRange(clean.length, clean.length); }
  };
  input.addEventListener("input", () => { stripScheme(); say(""); });
  input.addEventListener("change", stripScheme);
  setTimeout(stripScheme, 600); // browser autofill
  own.addEventListener("change", () => say(""));
  demoBtn.addEventListener("click", () => start({ demo: true, pack: "consent" }, "Lumen demo shop"));

  /* ---------- census ---------- */
  (async () => {
    const wall = $("#wall"), note = $("#censusNote");
    let data = null;
    try { data = await (await fetch("assets/census.json", { cache: "no-store" })).json(); } catch {}
    if (!data || !data.rows || !data.rows.length) {
      wall.innerHTML = `<p class="wall-empty">The census is running. Each site Kane visits lands here, anonymised.</p>`;
      return;
    }
    const S = data.summary;
    setRoll("stat-sites", S.sites); setRoll("stat-viol", S.violations); setRoll("stat-pass", S.passed);
    setRoll("stat-countries", S.countries); setRoll("stat-credits", S.credits);
    note.textContent = `Kane CLI visited ${S.sites} popular sites in ${S.countries} countries as a new visitor, clicked Reject wherever a cookie banner was shown, kept browsing and recorded every request.${S.notJudged ? ` ${S.notJudged} could not be judged: they blocked automated browsers, showed Kane no banner, or gave no way to refuse.` : ""} Sites are anonymised. Evidence, not legal advice.`;
    const word = { violation: "Tracked without consent", pass: "Held up" };
    const order = { violation: 0, pass: 1 };
    const rows = [...data.rows].sort((a, b) => (order[a.verdict] ?? 2) - (order[b.verdict] ?? 2) || b.afterReject - a.afterReject);
    wall.innerHTML = rows.map((r, i) => {
      const cls = r.verdict === "violation" || r.verdict === "pass" ? r.verdict : "unjudged";
      const facts = cls === "unjudged"
        ? `<span>${r.blocked ? "The site blocked automated browsers" : r.bannerShown === false ? "No cookie banner shown to Kane" : "Kane found no way to refuse"}</span>`
        : `<span><b>${r.afterReject}</b> tracker request${r.afterReject === 1 ? "" : "s"} after Reject</span>
           <span><b>${r.beforeChoice}</b> before any choice</span>
           ${r.visitorIds ? `<span><b>${r.visitorIds}</b> visitor ID${r.visitorIds === 1 ? "" : "s"} sent after Reject</span>` : ""}
           ${r.trackers && r.trackers.length ? `<span>${esc(r.trackers.slice(0, 3).join(", "))}</span>` : ""}
           ${r.review ? `<span class="review">Checked by hand: ${esc(r.review)}</span>` : ""}`;
      return `<article class="site ${cls} reveal" style="transition-delay:${(i % 4) * 80}ms"><div class="site-top"><h3>${esc(r.label)}</h3><span class="badge">${word[r.verdict] || "Not judged"}</span></div><div class="facts">${facts}</div></article>`;
    }).join("");
    $$(".reveal", wall).forEach((el) => revealer.observe(el));
  })();

  /* ---------- terminal: replay of a real demo:fix run ---------- */
  const TERM = [
    ["prompt", "$ npm run demo:fix"], ["", ""],
    ["", "Statute · Reject means reject"],
    ["dim", "Kane is visiting http://localhost:4173..."],
    ["dim", "  step 2 done: click: Rejecting all cookies in the cookie banner"],
    ["dim", "  step 3 done: click: Clicking View product on the first product card"],
    ["bad", "VIOLATION: Kane recorded 5 tracker requests after the visitor clicked \"Reject\", 3 before they had chosen anything."],
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
