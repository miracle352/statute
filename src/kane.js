// Runs kane-cli in agent mode and returns its parsed NDJSON stream.
const { spawn } = require("child_process");

function run(objective, { headless = true, maxSteps = 25, timeout = 300, onEvent } = {}) {
  if (objective.includes('"')) throw new Error("objective must not contain double quotes");
  const args = ["run", `"${objective}"`, "--agent", "--max-steps", String(maxSteps), "--timeout", String(timeout)];
  if (headless) args.push("--headless");

  return new Promise((resolve, reject) => {
    // shell:true so Windows finds the kane-cli.cmd shim; the objective is quoted above.
    const child = spawn("kane-cli", args, {
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
