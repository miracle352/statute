// Writes the human report and the fix packet a coding agent reads.
const fs = require("fs");
const path = require("path");

const PHASE = { after: 'After "Reject"', before: "Before any choice", unknown: "During the visit" };

function write(outDir, pack, result, meta) {
  fs.mkdirSync(outDir, { recursive: true });
  const json = { pack: pack.id, title: pack.title, rule: pack.rule, laws: pack.laws, ...result, ...meta };
  fs.writeFileSync(path.join(outDir, `${pack.id}.json`), JSON.stringify(json, null, 2));

  const lines = [];
  const badge = { pass: "PASS", violation: "VIOLATION", inconclusive: "INCONCLUSIVE" }[result.verdict];
  lines.push(`# ${badge}: ${pack.title}`, "", result.why, "");
  if (result.rejectClick) {
    lines.push(`Kane clicked **${result.rejectClick.label}**${result.rejectClick.time ? ` at ${result.rejectClick.time}` : ""}.`, "");
  }
  lines.push("## Rule", "", pack.rule, "");
  lines.push("## Why it matters", "");
  for (const l of pack.laws) lines.push(`- **${l.ref}**: ${l.gist}`);
  lines.push("", "_Evidence, not legal advice._", "");

  const reqs = result.trackerRequests || [];
  if (reqs.length) {
    lines.push("## Tracker requests Kane recorded", "", "| When | Tracker | Endpoint | Times | Pages | Visitor ID sent |", "|---|---|---|---|---|---|");
    const order = { after: 0, before: 1, unknown: 2 };
    for (const r of [...reqs].sort((a, b) => order[a.phase] - order[b.phase])) {
      lines.push(`| ${PHASE[r.phase]} | ${r.tracker} | ${r.method || ""} ${r.url} | ${r.count} | ${r.pages.join(", ")} | ${r.ids.join("; ")} |`);
    }
    lines.push("");
  }
  if ((result.trackerCookies || []).length) {
    lines.push("## Tracker cookies present", "", result.trackerCookies.map((c) => `\`${c}\``).join(", "), "");
  }
  if (result.verdict === "violation") lines.push("## How to fix", "", pack.fixHint, "");
  lines.push("## Evidence", "");
  if (meta.evidence) lines.push(`- Sealed Kane evidence pack: \`${meta.evidence}\` (open with \`kane-cli evidence serve <path>\`)`);
  if (meta.testUrl) lines.push(`- Kane run: ${meta.testUrl}`);
  if (meta.kaneStatus === "failed") lines.push(`- Kane's run ended early (${String(meta.kaneSummary || "no reason given").split("\n")[0]}); the verdict uses what it recorded up to that point.`);
  if (meta.credits != null) lines.push(`- Credits used: ${Number(meta.credits).toFixed(1)}`);
  lines.push("");
  fs.writeFileSync(path.join(outDir, `${pack.id}.md`), "\ufeff" + lines.join("\n"));
  return path.join(outDir, `${pack.id}.md`);
}

module.exports = { write };
