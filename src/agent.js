// Hands a Statute report to a coding agent (Claude Code, headless) and lets it fix the app.
const { spawn } = require("child_process");

function prompt({ pack, reportMd, appDir }) {
  return [
    `Statute ran Kane CLI against this app and found a compliance violation: "${pack.title}".`,
    `Rule: ${pack.rule}`,
    "",
    "Fix the app's source code so the rule holds. Requirements:",
    "- Work only inside the current folder (the app). Do not touch any statute-report files.",
    "- Make the smallest change that fixes the root cause. Do not delete analytics or ads entirely:",
    "  after the visitor clicks Accept, the tags must still load.",
    "- The check runs in a fresh browser with no cookies, so behaviour on first visit matters.",
    "- You may run `node --check <file>` to syntax-check JavaScript you changed.",
    "- When you are done, reply with two short lines: what was wrong, what you changed.",
    "",
    `App folder: ${appDir}`,
    "",
    "Here is Statute's report, based on what Kane recorded in a real browser:",
    "",
    reportMd,
  ].join("\n");
}

// Runs `claude -p` with the prompt on stdin. Returns Claude's final text.
function fix({ pack, reportMd, appDir, onLine }) {
  return new Promise((resolve, reject) => {
    const cmd = "claude -p --permission-mode acceptEdits --allowedTools Read,Edit,Write,Glob,Grep \"Bash(node --check:*)\"";
    const child = spawn(cmd, { cwd: appDir, shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (onLine) for (const l of String(d).split("\n")) if (l.trim()) onLine(l);
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !out.trim()) return reject(new Error(`claude exited with ${code}: ${err.slice(-1500)}`));
      resolve(out.trim());
    });
    child.stdin.end(prompt({ pack, reportMd, appDir }));
  });
}

module.exports = { fix, prompt };
