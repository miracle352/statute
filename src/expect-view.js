// What the judge page draws: the run on one time axis. Each step's recorded
// window, the gaps Kane didn't record, every request (site, tracker or other
// host), page loads, and which requests broke an expectation.
const expect = require("./expect");

const MAX_REQUESTS = 2500;

function pathOf(u) {
  try { const x = new URL(u); return x.pathname; } catch { return ""; }
}

function view(pack, judged) {
  const times = [...pack.actions.map((a) => a.time), ...pack.requests.map((r) => r.time)].filter(Boolean);
  if (!times.length) return null;
  const t0 = Math.min(...times);
  const end = Math.max(...times);
  const rel = (t) => (t == null ? null : t - t0);
  const home = expect.homeSite(pack);

  // A request is flagged when a broken expectation names it (same URL, and the
  // same moment when the evidence has one).
  const flags = [];
  for (const r of judged.results) {
    if (r.status !== "fail") continue;
    for (const e of r.evidence || []) if (e && e.url) flags.push({ url: e.url, time: e.time ? Date.parse(e.time) : null, rule: r.rule, value: e.value || null });
  }
  const short = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u; } };
  const flagFor = (r) => flags.find((f) => (f.url === r.url || f.url === short(r.url)) && (f.time == null || f.time === r.time));

  const steps = pack.sections.map((s) => {
    const t = [...s.actions.map((a) => a.time), ...s.requests.map((r) => r.time)].filter(Boolean);
    return {
      index: s.index,
      title: s.title,
      from: t.length ? rel(Math.min(...t)) : null,
      to: t.length ? rel(Math.max(...t)) : null,
      actions: s.actions.filter((a) => a.time).map((a) => ({ t: rel(a.time), type: a.type, text: (a.instruction || a.intent || "").slice(0, 140) })),
    };
  });

  const requests = pack.requests.filter((r) => r.time).slice(0, MAX_REQUESTS).map((r) => {
    const host = expect.hostOf(r.url);
    const hit = expect.trackerHit(r);
    const f = flagFor(r);
    return {
      t: rel(r.time), step: r.section, method: r.method, status: r.status, host,
      path: pathOf(r.url).slice(0, 120),
      kind: expect.site(host) === home ? "site" : hit ? (hit.counted ? "tracker" : "tracker-quiet") : "other",
      tracker: hit ? hit.tracker : null,
      flagged: f ? { rule: f.rule, value: f.value } : null,
      url: f ? r.url.slice(0, 4000) : null,
    };
  });

  const loads = pack.requests
    .filter((r) => r.time && expect.site(expect.hostOf(r.url)) === home && (r.mime ? /html/i.test(r.mime) : r.method === "GET" && !/\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|json)(\?|$)/i.test(r.url)))
    .map((r) => ({ t: rel(r.time), path: pathOf(r.url) }));

  // Gaps: stretches between recorded windows, longer than half a second.
  const windows = steps.filter((s) => s.from != null).map((s) => [s.from, s.to]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (let i = 1; i < windows.length; i++) {
    const a = Math.max(...windows.slice(0, i).map((w) => w[1]));
    const b = windows[i][0];
    if (b - a > 500) gaps.push({ from: a, to: b });
  }
  const early = expect.settle(pack);

  return {
    duration: end - t0, home, steps, requests, truncated: pack.requests.length > MAX_REQUESTS,
    loads, gaps, settle: early ? { recorded: early.gap, needed: expect.SETTLE_MS, path: pathOf(early.url) } : null,
  };
}

module.exports = { view };
