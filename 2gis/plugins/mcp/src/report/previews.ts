import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Item } from "./sources.js";

/** Photos shown per post; the rest are counted as "+N". */
const PER_POST = 4;
/** One photo larger than this is skipped (a full-size photo without a thumbnail). */
const MAX_FILE = 200 * 1024;
/** All photos in one report: keeps report.html small enough to attach to an email. */
const BUDGET = 6 * 1024 * 1024;
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

/** Swaps Threads photo paths for data: URIs, newest posts first, so report.html stays one self-contained file. */
export function embedPreviews(items: Item[], threadsRoot: string | null): void {
  const dataDir = threadsRoot ? resolve(threadsRoot, "data") : null;
  let used = 0;
  for (const item of items) {
    const paths = item.media;
    item.media = [];
    if (!dataDir) continue;
    for (const path of paths.slice(0, PER_POST)) {
      const file = resolve(dataDir, path);
      const mime = MIME[extname(file).toLowerCase()];
      if (!mime || !file.startsWith(dataDir + sep) || !existsSync(file)) continue;
      const size = statSync(file).size;
      if (size > MAX_FILE || used + size > BUDGET) continue;
      used += size;
      item.media.push(`data:${mime};base64,${readFileSync(file).toString("base64")}`);
    }
  }
}

