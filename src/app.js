// Starts and stops the app under test so each Kane run sees the latest code.
const { spawn, execSync } = require("child_process");
const http = require("http");
const https = require("https");

function start(command, cwd) {
  const child = spawn(command, { cwd, shell: true, stdio: "ignore", detached: process.platform !== "win32" });
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
}

function ping(url) {
  return new Promise((resolve) => {
    const lib = /^https:/i.test(url) ? https : http;
    let req;
    try { req = lib.get(url, { headers: { "user-agent": "Mozilla/5.0 (Statute reachability check)" } }, (res) => { res.resume(); resolve(res.statusCode < 500); }); }
    catch { return resolve(false); }
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function waitUntilUp(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

module.exports = { start, stop, waitUntilUp, ping };
