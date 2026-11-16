// statute init: sets up a repository in one step.
// Writes the pull request workflow, the nightly watch, and statute.json for the
// Claude Code hook, then says which two secrets to add.
//
//   npx statute init --start "npm start" --url http://localhost:3000 [--live https://your-site.com] [--fix]
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

function guessStart(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const s = pkg.scripts || {};
    if (s.start) return "npm ci && npm start";
    if (s.preview) return "npm ci && npm run build && npm run preview";
    if (s.dev) return "npm ci && npm run dev";
  } catch {}
  if (fs.existsSync(path.join(cwd, "index.html"))) return "npx -y serve -l 3000 .";
  return null;
}

function repoSlug(cwd) {
  try {
    const u = execSync("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const m = u.match(/github\.com[:/](.+?)(\.git)?$/);
    return m ? m[1] : null;
  } catch { return null; }
}

const q = (s) => JSON.stringify(String(s));

function prWorkflow({ url, start, fix }) {
  return `# Statute: Kane CLI checks each pull request against consumer law in a real browser.
# It reads the diff first and only runs the checks the change could affect.
name: Statute
on: pull_request

permissions:
  contents: ${fix ? "write" : "read"}
  pull-requests: write

jobs:
  statute:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0${fix ? "\n          ref: ${{ github.head_ref }}" : ""}
      - uses: miracle352/statute@main
        with:
          check: auto
          url: ${q(url)}
          start: ${q(start)}
          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}${fix ? `
          fix: "true"
          claude-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` : ""}
`;
}

function watchWorkflow({ live }) {
  return `# Statute watch: Kane checks the live site every night. Opens an issue on a
# violation and closes it once the site passes again.
name: Statute watch
on:
  schedule:
    - cron: "17 2 * * *"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: miracle352/statute@main
        with:
          url: ${q(live)}
          check: consent price
          issue: "true"
          fail-on: never
          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
`;
}

function write(file, text, force) {
  if (fs.existsSync(file) && !force) { console.log(`  kept     ${path.relative(process.cwd(), file)} (exists; --force to replace)`); return false; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`  wrote    ${path.relative(process.cwd(), file)}`);
  return true;
}

module.exports = function init() {
  const cwd = process.cwd();
  const force = !!arg("force", false);
  const start = arg("start") && arg("start") !== true ? arg("start") : guessStart(cwd);
  const url = arg("url") && arg("url") !== true ? arg("url") : "http://localhost:3000";
  const live = arg("live") && arg("live") !== true ? arg("live") : null;
  const fix = !!arg("fix", false);

  if (!start) {
    console.error("Statute could not tell how to start your app. Run it again with --start \"<command>\" and --url <where it listens>.");
    process.exit(2);
  }

  console.log("\nSetting up Statute in " + cwd + "\n");
  write(path.join(cwd, ".github", "workflows", "statute.yml"), prWorkflow({ url, start, fix }), force);
  if (live) write(path.join(cwd, ".github", "workflows", "statute-watch.yml"), watchWorkflow({ live }), force);
  write(path.join(cwd, "statute.json"), JSON.stringify({ check: ["consent"], url, start, rounds: 3 }, null, 2) + "\n", force);

  const slug = repoSlug(cwd);
  const secrets = slug ? `https://github.com/${slug}/settings/secrets/actions` : "your repository's Settings → Secrets and variables → Actions";
  console.log(`
Next:
  1. Add these repository secrets at ${secrets}
       LT_USERNAME     your TestMu AI username   (free account: https://www.testmuai.com/kane-cli/)
       LT_ACCESS_KEY   your TestMu AI access key${fix ? `
       CLAUDE_CODE_OAUTH_TOKEN   run \`claude setup-token\` and paste what it prints` : ""}
  2. Commit and push. Every pull request that touches tracking, prices or
     subscriptions now gets Kane in a real browser and a verdict on the PR.${fix ? `
     On a violation, Claude Code fixes it and the fix is pushed only after Kane passes.` : ""}${live ? `
  3. The watch checks ${live} every night and opens an issue if it breaks the law.` : `
  3. Optional: run again with --live https://your-site.com to watch production every night.`}

  To have Claude Code check its own work before it says "done", add this to .claude/settings.json:
    { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "timeout": 600, "command": "npx -y statute hook" } ] } ] } }

  Try a check right now: npx statute check consent --url ${url} --start ${q(start)}
`);
};
