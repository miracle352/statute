// Expectations for a Kane run nobody wrote any for, worked out with code from
// what Kane did: where it typed, and where it refused cookies.
const expect = require("./expect");

// The words on a "refuse" button, in the languages the census met.
const REFUSE = /\b(reject\w*|declin\w*|refus\w*|deny\w*|denied|disagree\w*|only (strictly )?necessary|necessary only|essential only|weiger\w*|ablehn\w*|rechaz\w*|rifiut\w*|recus\w*|rejeit\w*|odrzu\w*|avvisa|afvis|hylkää|nur notwendige)\b/i;

const quoteable = (t) => t && !t.includes('"');

// "Decline advertising cookies" refuses one kind, not all of them.
const PARTIAL = /\b(advertis\w*|marketing|ads?|analytics|performance|statistic\w*|werbung|publicit\w*)\b/i;

function infer(pack) {
  const out = [];
  const add = (rule, why) => { if (!out.some((r) => r.rule === rule)) out.push({ rule, why }); };

  for (const s of pack.sections) {
    const refused = s.actions.find((a) => /click|tap|press/i.test(a.type || "") && REFUSE.test(a.instruction || "") && !PARTIAL.test(a.instruction || ""));
    // Anchor on the click itself (its own words), so "after" starts at the refusal.
    const click = refused && (refused.instruction || "").trim();
    if (quoteable(click) && click.length >= 6) {
      add(`no request to a tracker after "${click}"`, "Kane refused cookies here");
      add(`no visitor ID sent to a tracker after "${click}"`, "a refusal means no tracking ID either");
      add(`no tracker cookie after "${click}"`, "nor tracker cookies");
    }
    if (quoteable(s.title) && expect.typedValues(s.actions).length) add(`what was typed in "${s.title}" never leaves this site`, "Kane typed something here");
  }
  add("no server errors", "always");
  return out;
}

module.exports = { infer, REFUSE, PARTIAL };
