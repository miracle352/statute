// Runs kane-cli in agent mode and returns its parsed NDJSON stream.
const { spawn } = require("child_process");

function run(objective, { headless = true, maxSteps = 25, timeout = 300, onEvent } = {}) {
  // The objective goes through the shell inside double quotes, so refuse anything
  // that could break out of them (cmd.exe and sh metacharacters).
  if (/["%^&|<>`$\\]/.test(objective)) {
    throw new Error("objective contains a character that is unsafe to pass to the shell");
  }
  let cmd = `kane-cli run "${objective}" --agent --max-steps ${Number(maxSteps)} --timeout ${Number(timeout)}`;
  if (headless) cmd += " --headless";

  return new Promise((resolve, reject) => {
    // One command string with shell:true so Windows finds the kane-cli.cmd shim.
    const child = spawn(cmd, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, KANE_CLI_USER_AGENT: "statute" },
    });
    const events = [];
    let buf = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        try {
          const ev = JSON.parse(line);
          events.push(ev);
          if (onEvent) onEvent(ev);
        } catch { /* ignore partial or non-JSON lines */ }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      const end = events.find((e) => e.type === "run_end");
      resolve({ code, events, end, stderr });
    });
  });
}

module.exports = { run };
