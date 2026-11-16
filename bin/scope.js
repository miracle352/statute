#!/usr/bin/env node
// Decides which Statute checks a code change could affect, by reading the diff.
// No AI, no Kane credits: plain pattern matching on the changed lines.
//
//   git diff origin/main...HEAD | node bin/scope.js          -> prints e.g. "consent price"
//   node bin/scope.js --base origin/main                       -> runs git diff itself
//   --json                                                     -> reasons per check
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const trackers = require("../rules/trackers.json").domains.map((d) => d.split("/")[0]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RULES = {
  consent: [
    { why: "a tracker domain", re: new RegExp(trackers.map(esc).join("|"), "i") },
    { why: "an analytics or ads call", re: /\b(gtag\s*\(|fbq\s*\(|ttq\.|_hsq|dataLayer\.push|analytics\.(track|page|identify)|posthog\.|mixpanel\.|amplitude\.|hotjar|clarity\(|plausible|umami|segment)/i },
    { why: "cookie or consent code", re: /\b(cookie|consent|gdpr|ccpa|onetrust|cookiebot|didomi|usercentrics|iubenda|tcf|__tcfapi|reject[_\- ]?all|accept[_\- ]?all)/i },
  ],
  price: [
    { why: "a fee or surcharge", re: /\b(fee|fees|surcharge|service[_\- ]?charge|handling|convenience|booking[_\- ]?fee|processing)\b/i },
    { why: "price or total calculation", re: /\b(price|subtotal|total|checkout|cart|basket|amount|currency)\b/i },
  ],
  cancel: [
    { why: "subscription or cancellation flow", re: /\b(subscri\w*|cancel\w*|unsubscribe|membership|renew\w*|billing|plan[_\- ]?(change|cancel))\b/i },
  ],
};

// Files whose changes never affect what a visitor's browser does.
const IGNORE = /(^|\/)(README|CHANGELOG|LICENSE)[^/]*$|\.(md|txt|lock)$|(^|\/)(test|tests|__tests__|spec|docs)\//i;

function parseDiff(text) {
  const files = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) { cur = { file: m[1], lines: [] }; files.push(cur); continue; }
    if (!cur) continue;
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) cur.lines.push(line.slice(1));
  }
  return files.filter((f) => !IGNORE.test(f.file));
}

function scope(diffText) {
  const files = parseDiff(diffText);
  const hits = {};
  for (const [check, rules] of Object.entries(RULES)) {
    for (const f of files) {
      for (const line of f.lines) {
        const r = rules.find((x) => x.re.test(line));
        if (r) {
          (hits[check] = hits[check] || []).push({ file: f.file, why: r.why, line: line.trim().slice(0, 120) });
          break;
        }
      }
    }
  }
  return { files: files.map((f) => f.file), checks: Object.keys(hits), reasons: hits };
}

if (require.main === module) {
  const i = process.argv.indexOf("--base");
  let diff;
  if (i > 0) diff = execSync(`git diff ${process.argv[i + 1]}...HEAD`, { encoding: "utf8", maxBuffer: 64 << 20 });
  else diff = fs.readFileSync(0, "utf8");
  const r = scope(diff);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else console.log(r.checks.join(" "));
}

module.exports = { scope, parseDiff };
