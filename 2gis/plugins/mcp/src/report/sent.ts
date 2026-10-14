import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "../scraper/config.js";
import type { Item } from "./sources.js";

/** Mentions already emailed: id -> when a report first included it (data/report-sent.json). */
type Sent = Record<string, string>;

const sentPath = (root: string) => join(paths(root).data, "report-sent.json");

function loadSent(root: string): Sent {
  const file = sentPath(root);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed.sent === "object" && parsed.sent ? parsed.sent : {};
  } catch {
    return {};
  }
}

/** Sets item.sent_at for mentions earlier emailed reports already contained. */
export function markSeen(root: string, items: Item[]): void {
  const sent = loadSent(root);
  for (const item of items) item.sent_at = sent[item.id] ?? null;
}

/** Records the mentions of a report that was just emailed; earlier dates are kept. */
export function recordSent(root: string, items: Item[], at: string): number {
  const sent = loadSent(root);
  let added = 0;
  for (const item of items) {
    if (sent[item.id]) continue;
    sent[item.id] = at;
    added += 1;
  }
  const file = sentPath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ sent }, null, 2) + "\n", "utf8");
  return added;
}
