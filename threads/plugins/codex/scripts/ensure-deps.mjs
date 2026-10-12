// SessionStart hook: get the plugin's Node dependencies in place so that
// `/plugin install` is the only manual step.
//
// The hook itself returns immediately. Installing Playwright pulls ~150 MB of
// Chromium, which would otherwise stall the user's first session, so the real
// work is spawned as a detached child and coordinated through a lock file that
// the MCP server also understands (see src/scraper/playwright.ts).
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const self = fileURLToPath(import.meta.url);
const plugin = join(dirname(self), "..");
const stampFile = join(plugin, ".deps-ok");
const lockFile = join(plugin, ".deps-lock");
const STALE_MS = 5 * 60 * 1000;

const version = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8")).version ?? "0";

const done = () => existsSync(stampFile) && readFileSync(stampFile, "utf8").trim() === version;
const locked = () => {
  try {
    return Date.now() - statSync(lockFile).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
};
const touch = () => writeFileSync(lockFile, String(process.pid), "utf8");

function run(command, args) {
  return spawnSync(command, args, {
    cwd: plugin,
    stdio: ["ignore", "ignore", "ignore"],
    shell: true,
    env: { ...process.env, npm_config_yes: "true" },
  });
}

if (process.argv[2] === "--run") {
  // Detached worker: do the slow part.
  try {
    touch();
    if (!existsSync(join(plugin, "node_modules", "playwright", "package.json"))) {
      if (run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"]).status !== 0) {
        rmSync(lockFile, { force: true });
        process.exit(0);
      }
    }
    touch();
    run("npx", ["--no-install", "playwright", "install", "chromium"]);
    writeFileSync(stampFile, version, "utf8");
  } finally {
    rmSync(lockFile, { force: true });
  }
  process.exit(0);
}

// Hook entry point: never block, never fail a session.
if (!done() && !locked()) {
  spawn(process.execPath, [self, "--run"], {
    cwd: plugin,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}
process.exit(0);
