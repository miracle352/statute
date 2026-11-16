#!/usr/bin/env node
// Statute as an MCP server (stdio). Any coding agent that speaks MCP (Claude Code,
// Cursor, Codex...) can ask Kane CLI to check a page against a law and get the
// verdict back in its own conversation.
//
//   claude mcp add statute -- npx -y statute mcp
//
// Each check runs `statute check` in a child process, so Kane's progress output
// never mixes with the protocol on stdout.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PACKS = {
  consent: require("../src/packs/consent"),
  price: require("../src/packs/price"),
  cancel: require("../src/packs/cancel"),
};
const VERSION = require("../package.json").version;

const TOOLS = [
  {
    name: "statute_check",
    description:
      "Have Kane CLI open a page in a real browser and check it against a consumer-protection rule. " +
      "The verdict (pass, violation or inconclusive) is computed by code from Kane's sealed evidence. " +
      "Checks: consent (after Reject, no tracker may load), price (the price shown is the price paid), " +
      "cancel (cancelling online takes no more steps than signing up). Takes one to four minutes and " +
      "spends Kane credits. Use it after changing cookie banners, analytics tags, pricing or subscription flows.",
    inputSchema: {
      type: "object",
      properties: {
        check: { type: "string", enum: Object.keys(PACKS), description: "Which rule to check." },
        url: { type: "string", description: "Address Kane should visit, for example http://localhost:3000/." },
        start: { type: "string", description: "Optional command that starts the app first, for example `npm run dev`. Statute stops it afterwards." },
        cwd: { type: "string", description: "Folder to run `start` in. Defaults to the folder the agent is working in." },
      },
      required: ["check", "url"],
    },
  },
  {
    name: "statute_rules",
    description: "List Statute's checks with the rule each one enforces and the laws behind it. Instant, no credits.",
    inputSchema: { type: "object", properties: {} },
  },
];

function rulesText() {
  return Object.values(PACKS).map((p) =>
    `## ${p.id}: ${p.title}\n${p.rule}\n${p.laws.map((l) => `- ${l.ref}: ${l.gist}`).join("\n")}\nHow to fix: ${p.fixHint}`
  ).join("\n\n");
}

function runCheck({ check, url, start, cwd }) {
  return new Promise((resolve) => {
    if (!PACKS[check]) return resolve({ text: `Unknown check "${check}". Use one of: ${Object.keys(PACKS).join(", ")}.`, isError: true });
    if (!/^https?:\/\//i.test(url || "")) return resolve({ text: "url must start with http:// or https://", isError: true });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "statute-mcp-"));
    const args = [path.join(ROOT, "bin", "statute.js"), "check", check, "--url", url, "--out", out];
    if (start) args.push("--start", start);
    const child = spawn(process.execPath, args, { cwd: cwd || process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d; process.stderr.write(d); });
    child.stderr.on("data", (d) => { log += d; process.stderr.write(d); });
    child.on("close", (code) => {
      const verdict = code === 0 ? "pass" : code === 1 ? "violation" : "inconclusive";
      let report = "";
      try { report = fs.readFileSync(path.join(out, `${check}.md`), "utf8").replace(/^﻿/, ""); } catch {}
      const caseFile = path.join(out, "index.html");
      const tail = log.trim().split("\n").slice(-6).join("\n");
      const text = report
        ? `Statute verdict: ${verdict.toUpperCase()}\n\n${report}\n\nCase file with Kane's screenshots: ${caseFile}`
        : `Statute could not finish the ${check} check (exit ${code}).\n\n${tail}`;
      resolve({ text, isError: !report, verdict });
    });
  });
}

// --- MCP over stdio: newline-delimited JSON-RPC 2.0 ---
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return send({ id, result: {
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "statute", version: VERSION },
      instructions: "Statute checks web pages against consumer-protection law with Kane CLI. Call statute_check after changing consent banners, tracking tags, prices or subscription flows, and fix any violation it reports before finishing.",
    } });
  }
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const name = params && params.name;
    const a = (params && params.arguments) || {};
    if (name === "statute_rules") return send({ id, result: { content: [{ type: "text", text: rulesText() }] } });
    if (name === "statute_check") {
      const r = await runCheck(a);
      return send({ id, result: { content: [{ type: "text", text: r.text }], isError: !!r.isError } });
    }
    return send({ id, error: { code: -32602, message: `Unknown tool: ${name}` } });
  }
  if (method === "ping") return send({ id, result: {} });
  if (id !== undefined && !String(method || "").startsWith("notifications/")) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch((e) => msg.id !== undefined && send({ id: msg.id, error: { code: -32603, message: String(e.message || e) } }));
  }
});
