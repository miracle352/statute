// Writes the human report and the fix packet a coding agent reads.
const fs = require("fs");
const path = require("path");

function write(outDir, pack, result, meta) {
  fs.mkdirSync(outDir, { recursive: true });
  const json = { pack: pack.id, title: pack.title, rule: pack.rule, laws: pack.laws, ...result, ...meta };
  fs.writeFileSync(path.join(outDir, `${pack.id}.json`), JSON.stringify(json, null, 2));

  const lines = [];
  const badge = { pass: "PASS", violation: "VIOLATION", inconclusive: "INCONCLUSIVE" }[result.verdict];
  lines.push(`# ${badge}: ${pack.title}`, "", result.why, "");
  lines.push("## Rule", "", pack.rule, "");
  lines.push("## Why it matters", "");
  for (const l of pack.laws) lines.push(`- **${l.ref}**: ${l.gist}`);
  lines.push("", "_Evidence, not legal advice._", "");
  if (result.trackerRequests.length) {
    lines.push("## Tracker requests Kane recorded", "", "| Tracker | URL | Status | Time |", "|---|---|---|---|");
    for (const r of result.trackerRequests) lines.push(`| ${r.tracker} | ${r.url} | ${r.status ?? ""} | ${r.time ?? ""} |`);
    lines.push("");
  }
  if (result.trackerCookies.length) {
    lines.push("## Tracker cookies present", "", result.trackerCookies.map((c) => `\`${c}\``).join(", "), "");
  }
  if (result.verdict === "violation") lines.push("## How to fix", "", pack.fixHint, "");
  lines.push("## Evidence", "");
  if (meta.evidence) lines.push(`- Sealed Kane evidence pack: \`${meta.evidence}\` (open with \`kane-cli evidence serve <path>\`)`);
  if (meta.testUrl) lines.push(`- Kane run: ${meta.testUrl}`);
  if (meta.credits != null) lines.push(`- Credits used: ${meta.credits}`);
  lines.push("");
  fs.writeFileSync(path.join(outDir, `${pack.id}.md`), lines.join("\n"));
  return path.join(outDir, `${pack.id}.md`);
}

module.exports = { write };
