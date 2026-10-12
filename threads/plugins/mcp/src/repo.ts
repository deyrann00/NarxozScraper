import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Per-user data root used when the plugin is installed on its own. */
export function homeRoot(): string {
  return join(homedir(), ".narxoz-threads");
}

/** Directory of the installed plugin (parent of the bundled `server/`). */
export function pluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function repoCheckout(): string | undefined {
  const bundled = resolve(pluginRoot(), "..", "..");
  if (existsSync(join(bundled, "pyproject.toml"))) {
    return bundled;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pyproject.toml")) && existsSync(join(dir, "socnetscraper"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/**
 * Where posts, config and the browser session live.
 *
 * 1. `NARXOZ_SCRAPER_ROOT` when set
 * 2. the SocNetScraper checkout when running from it (dev)
 * 3. `~/.narxoz-threads`, created on demand, so a standalone plugin install works
 */
export function scraperRoot(): string {
  const fromEnv = process.env.NARXOZ_SCRAPER_ROOT?.trim();
  if (fromEnv) {
    const root = resolve(fromEnv);
    mkdirSync(root, { recursive: true });
    return root;
  }
  const checkout = repoCheckout();
  if (checkout) {
    return checkout;
  }
  const home = homeRoot();
  mkdirSync(home, { recursive: true });
  return home;
}

export function postsPath(root: string): string {
  return join(root, "data", "posts.jsonl");
}
