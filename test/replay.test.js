// Golden test: re-judge every recorded Kane run in replays/ and compare with the
// verdict recorded at the time. A change to a judge that flips a real verdict fails here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const evidence = require("../src/evidence");
const pack = require("../src/pack");
const expect = require("../src/expect");
const PACKS = Object.fromEntries(["consent", "consent-accept", "cancel", "price"].map((id) => [id, require(`../src/packs/${id}`)]));

const base = path.join(__dirname, "..", "replays");
const loops = fs.existsSync(base) ? fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, "loop.json"))) : [];

for (const name of loops) {
  const loop = JSON.parse(fs.readFileSync(path.join(base, name, "loop.json"), "utf8"));
  const dir = path.join(base, name, "evidence");
  const packs = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const t of loop.timeline.filter((t) => t.step === "kane")) {
    const file = String(t.evidence || "").split(/[\\/]/).pop();
    const kind = loop.pack === "expect" ? "expectations" : t.pack;
    test(`${name}: round ${t.round} ${kind} is still ${t.verdict}`, { skip: !packs.includes(file) && "evidence pack not present" }, () => {
      if (loop.pack === "expect") {
        const p = pack.read(path.join(dir, file));
        return assert.equal(expect.judge(p, p.expectations).verdict, t.verdict);
      }
      const network = evidence.networkFromPack(path.join(dir, file));
      const end = t.kaneStatus ? { status: t.kaneStatus, summary: t.kaneSummary } : null;
      const r = PACKS[t.pack].judge({ end, events: [], network, strict: !!loop.strict });
      assert.equal(r.verdict, t.verdict);
    });
  }
}
