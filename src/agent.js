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
function fix({ pack, reportMd, appDir, onLine, text }) {
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
      const said = (out + "\n" + err).trim();
      // A failed sign-in or a crash is not a fix, whatever Claude printed.
      if (code !== 0 || /failed to authenticate|not logged in|invalid api key|please run .?claude (auth )?login|credit balance is too low/i.test(said)) {
        return reject(new Error(`Claude Code did not run (exit ${code}): ${said.slice(-600)}`));
      }
      resolve(out.trim());
    });
    child.stdin.end(text || prompt({ pack, reportMd, appDir }));
  });
}

// For test files with expectations: the broken expectations are the brief.
function promptExpect({ reportMd, appDir, testName }) {
  return [
    `Statute ran the Kane CLI test "${testName}" against this app. Kane's steps ran, but the page broke expectations that Statute checked in Kane's recorded evidence (network traffic, cookies, console, values).`,
    "",
    "Fix the app's source code so every expectation holds. Requirements:",
    "- Work only inside the current folder (the app). Do not touch the test file or any statute-report files.",
    "- Fix the root cause, keep the feature working: the same steps must still succeed for a real user.",
    "- Do not switch off analytics or other features to make a rule pass unless the rule asks for that.",
    "- You may run `node --check <file>` to syntax-check JavaScript you changed.",
    "- When you are done, reply with two short lines: what was wrong, what you changed.",
    "",
    `App folder: ${appDir}`,
    "",
    "Statute's report:",
    "",
    reportMd,
  ].join("\n");
}

module.exports = { fix, prompt, promptExpect };
