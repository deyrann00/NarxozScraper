import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Per-user data root used when the plugin is installed on its own. */
export function homeRoot(): string {
  return join(homedir(), ".narxoz-2gis");
}

/** Directory of the installed plugin (parent of the bundled `server/`). */
export function pluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function isCheckout(dir: string): boolean {
  return existsSync(join(dir, "plugins", "mcp", "src", "scraper", "branches.ts"));
}

function repoCheckout(): string | undefined {
  const bundled = resolve(pluginRoot(), "..", "..");
  if (isCheckout(bundled)) {
    return bundled;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (isCheckout(dir)) {
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
 * Where reviews, config and run logs live.
 *
 * 1. `NARXOZ_2GIS_ROOT` when set
 * 2. the repo checkout when running from it (dev)
 * 3. `~/.narxoz-2gis`, created on demand, so a standalone plugin install works
 */
export function scraperRoot(): string {
  const fromEnv = process.env.NARXOZ_2GIS_ROOT?.trim();
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

export function reviewsPath(root: string): string {
  return join(root, "data", "reviews.jsonl");
}
