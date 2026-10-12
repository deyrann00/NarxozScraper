import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserType } from "playwright";
import { pluginRoot } from "../repo.js";

let cached: BrowserType | undefined;

/** Shared with scripts/ensure-deps.mjs: whoever holds this is installing. */
const STALE_MS = 5 * 60 * 1000;
const WAIT_MS = 12 * 60 * 1000;

function lockFile(): string {
  return join(pluginRoot(), ".deps-lock");
}

function lockHeld(): boolean {
  try {
    return Date.now() - statSync(lockFile()).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The SessionStart hook installs in a detached process. If it is mid-download,
 * wait for it rather than starting a second npm install in the same directory.
 */
async function waitForBackgroundInstall(): Promise<BrowserType | undefined> {
  if (!lockHeld()) {
    return undefined;
  }
  process.stderr.write("[narxoz-threads] waiting for the background Playwright install\n");
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && lockHeld()) {
    await sleep(3000);
  }
  return importChromium();
}

/**
 * npm/npx never inherit stdio here: stdout is the MCP stdio channel and any
 * stray byte on it corrupts the protocol. Progress goes to stderr instead.
 */
function run(command: string, args: string[]): { ok: boolean; output: string } {
  process.stderr.write(`[narxoz-threads] ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: pluginRoot(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, npm_config_yes: "true" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) {
    process.stderr.write(`${output}\n`);
  }
  return { ok: result.status === 0, output };
}

async function importChromium(): Promise<BrowserType | undefined> {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch {
    return undefined;
  }
}

function installMessage(detail: string): string {
  return [
    "Playwright could not be installed automatically.",
    `Run this once, then retry: cd "${pluginRoot()}" && npm install`,
    detail,
  ]
    .filter(Boolean)
    .join("\n");
}

/** True when Chromium's binary is actually on disk, not merely declared. */
function chromiumInstalled(chromium: BrowserType): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Resolve Chromium, installing the npm package and the browser binary on first
 * use so a fresh `/plugin install` needs no manual setup step.
 */
export async function getChromium(): Promise<BrowserType> {
  if (cached) {
    return cached;
  }
  let chromium = (await importChromium()) ?? (await waitForBackgroundInstall());
  if (!chromium) {
    if (!existsSync(join(pluginRoot(), "package.json"))) {
      throw new Error(installMessage("No package.json next to the plugin server."));
    }
    writeFileSync(lockFile(), String(process.pid), "utf8");
    let install;
    try {
      install = run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"]);
    } finally {
      rmSync(lockFile(), { force: true });
    }
    chromium = await importChromium();
    if (!chromium) {
      throw new Error(installMessage(install.output.slice(-800)));
    }
  }
  if (!chromiumInstalled(chromium)) {
    writeFileSync(lockFile(), String(process.pid), "utf8");
    let browsers;
    try {
      browsers = run("npx", ["--no-install", "playwright", "install", "chromium"]);
    } finally {
      rmSync(lockFile(), { force: true });
    }
    if (!chromiumInstalled(chromium)) {
      throw new Error(
        [
          "Playwright is installed but its Chromium build is missing.",
          `Run this once, then retry: cd "${pluginRoot()}" && npx playwright install chromium`,
          browsers.output.slice(-800),
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }
  cached = chromium;
  return chromium;
}
