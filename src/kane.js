// Runs kane-cli in agent mode and returns its parsed NDJSON stream.
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Find kane-cli's own entry script so it can run without a shell when an argument
// (like a cloud endpoint URL) contains characters a shell would interpret.
let kaneBin;
function findKane() {
  if (kaneBin !== undefined) return kaneBin;
  kaneBin = null;
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const p = path.join(root, "@testmuai", "kane-cli", "bin", "kane-cli.cjs");
    if (fs.existsSync(p)) kaneBin = p;
  } catch {}
  return kaneBin;
}

// A TestMu AI cloud browser in a chosen country, for Kane's --ws-endpoint.
function cloudEndpoint({ country, username, accessKey, name }) {
  const caps = {
    browserName: "Chrome",
    browserVersion: "latest",
    "LT:Options": { platform: "Windows 11", build: "Statute", name: name || "Statute audit", user: username, accessKey, geoLocation: country, video: false, console: false },
  };
  return `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify(caps))}`;
}

function run(objective, { headless = true, maxSteps = 25, timeout = 300, onEvent, cdpEndpoint, wsEndpoint, username, accessKey } = {}) {
  // Preferred path: start kane-cli directly, with no shell, so the objective can
  // contain any character. The shell path below is only a fallback.
  if (findKane()) {
    const args = ["run", objective, "--agent", "--max-steps", String(Number(maxSteps)), "--timeout", String(Number(timeout))];
    if (wsEndpoint) args.push("--ws-endpoint", wsEndpoint);
    else if (cdpEndpoint) {
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpEndpoint)) throw new Error("bad CDP endpoint");
      args.push("--cdp-endpoint", cdpEndpoint);
    } else if (headless) args.push("--headless");
    if (username || accessKey) args.push("--username", String(username || ""), "--access-key", String(accessKey || ""));
    return runArgs(args, onEvent, timeout);
  }
  if (wsEndpoint) throw new Error("Could not find kane-cli's install folder (npm root -g), which cloud runs need.");
  // The objective goes through the shell inside double quotes, so refuse anything
  // that could break out of them (cmd.exe and sh metacharacters).
  if (/["%^&|<>`$\\]/.test(objective)) {
    throw new Error("objective contains a character that is unsafe to pass to the shell");
  }
  let cmd = `kane-cli run "${objective}" --agent --max-steps ${Number(maxSteps)} --timeout ${Number(timeout)}`;
  if (cdpEndpoint) {
    // Drive a Chrome we launched ourselves (so we can watch it live).
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpEndpoint)) throw new Error("bad CDP endpoint");
    cmd += ` --cdp-endpoint ${cdpEndpoint}`;
  } else if (headless) cmd += " --headless";
  if (username || accessKey) {
    // Non-interactive auth for servers and CI. Values come from the environment.
    if (!/^[\w.@+-]+$/.test(username || "") || !/^[\w.@+-]+$/.test(accessKey || "")) throw new Error("LT_USERNAME / LT_ACCESS_KEY have unexpected characters");
    cmd += ` --username ${username} --access-key ${accessKey}`;
  }

  return collect(spawn(cmd, {
    // One command string with shell:true so Windows finds the kane-cli.cmd shim.
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, KANE_CLI_USER_AGENT: "statute" },
  }), onEvent, timeout);
}

// Run kane-cli with an argument list and no shell at all.
function runArgs(args, onEvent, timeout) {
  const bin = findKane();
  if (!bin) return Promise.reject(new Error("Could not find kane-cli's install folder (npm root -g). Install it with: npm i -g @testmuai/kane-cli"));
  return collect(spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KANE_CLI_USER_AGENT: "statute" } }), onEvent, timeout);
}

// Kill kane-cli and everything it started (its runner and browser children).
function killTree(child) {
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {}
}

function collect(child, onEvent, timeout = 300) {
  return new Promise((resolve, reject) => {
    // Kane's own --timeout is not always honoured (a cloud run hung for hours),
    // so a wall-clock limit sits on top of it.
    let killed = false;
    const limit = setTimeout(() => { killed = true; killTree(child); }, (Number(timeout) + 90) * 1000);
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
      clearTimeout(limit);
      let end = events.find((e) => e.type === "run_end");
      if (!end && killed) end = { status: "timeout", summary: `Kane did not finish within ${Number(timeout) + 90} seconds and was stopped.`, credits_consumed: 0 };
      resolve({ code, events, end, stderr, killed });
    });
  });
}

// True when kane-cli is installed globally or on PATH.
function available() {
  if (findKane()) return true;
  try { execSync(process.platform === "win32" ? "where kane-cli" : "command -v kane-cli", { stdio: "ignore" }); return true; } catch { return false; }
}

module.exports = { available, run, cloudEndpoint, collect, binary: findKane };
