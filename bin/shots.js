#!/usr/bin/env node
// Pulls the one screenshot that matters out of each Kane evidence pack in a report folder,
// so a pull request comment can show what Kane saw.
//   node bin/shots.js <report-dir> <out-dir>   -> writes images and shots.json
const fs = require("fs");
const path = require("path");
const { steps } = require("../src/page");

const PICK = {
  consent: /reject|declin|refus/i,
  "consent-accept": /accept|agree|allow/i,
};

function packsIn(dir) {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".evidence")) found.push(p);
    }
  })(dir);
  // file names end in -<timestamp>.evidence: keep the order Kane ran them in
  const ts = (p) => Number((p.match(/-(\d+)\.evidence$/) || [])[1] || 0);
  return found.sort((a, b) => ts(a) - ts(b));
}

function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) { console.error("usage: shots.js <report-dir> <out-dir>"); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const list = [];
  const seen = new Set();
  for (const pack of packsIn(dir)) {
    const id = path.basename(pack).replace(/-\d+\.evidence$/, "");
    const all = steps(pack).filter((s) => s.img);
    if (!all.length) continue;
    const re = PICK[id];
    const shot = (re && [...all].reverse().find((s) => re.test(s.caption))) || all[all.length - 1];
    const m = shot.img.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) continue;
    const hash = require("crypto").createHash("sha1").update(m[2]).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    const file = `${String(list.length + 1).padStart(2, "0")}-${id}.${m[1] === "png" ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(out, file), Buffer.from(m[2], "base64"));
    list.push({ file, pack: id, step: shot.n, caption: shot.caption });
  }
  fs.writeFileSync(path.join(out, "shots.json"), JSON.stringify(list, null, 2));
  console.log(`${list.length} screenshot(s) written to ${out}`);
}
main();
