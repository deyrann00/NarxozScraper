import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, paths } from "../scraper/config.js";
import type { Sentiment } from "../scraper/parse.js";
import { loadExisting, mergeReviews } from "../scraper/store.js";

export type Source = "2gis" | "threads";

/** One mention from either scraper, in the shape the combined report needs. */
export type Item = {
  source: Source;
  id: string;
  published_at: string | null;
  author: string;
  /** 2GIS branch, or the Threads post it answers. */
  place: string;
  text: string;
  /** 2GIS stars; Threads posts have none. */
  rating: number | null;
  url: string;
  /** 2GIS: Narxoz answered; Threads: always false. */
  org_answered: boolean;
  /** Threads reply: text of the post it answers. */
  reply_to: string;
  relevant: boolean | null;
  sentiment: Sentiment | null;
  topics: string[];
  summary: string;
};

/**
 * Threads scraper root (the folder that holds data/posts.jsonl):
 * report.threads_root, NARXOZ_SCRAPER_ROOT, ../threads next to this scraper, ~/.narxoz-threads.
 */
export function threadsRoot(root: string): string | null {
  const configured = loadConfig(root).report.threads_root.trim() || process.env.NARXOZ_SCRAPER_ROOT?.trim();
  const candidates = configured ? [resolve(root, configured)] : [resolve(root, "..", "threads"), join(homedir(), ".narxoz-threads")];
  return candidates.find((dir) => existsSync(join(dir, "data", "posts.jsonl"))) ?? (configured ? candidates[0] : null);
}

export function reportPath(root: string): string {
  const configured = loadConfig(root).report.output.trim() || process.env.NARXOZ_REPORT_PATH?.trim();
  return configured ? resolve(root, configured) : join(paths(root).data, "report.html");
}

function fromReviews(root: string): Item[] {
  const [reviews] = mergeReviews(loadExisting(root), []);
  return reviews.map((review) => ({
    source: "2gis",
    id: `2gis:${review.id}`,
    published_at: review.published_at,
    author: review.author || "",
    place: review.branch_name || "",
    text: review.text || "",
    rating: review.rating,
    url: review.url,
    org_answered: review.replies.some((reply) => reply.from_org),
    reply_to: "",
    relevant: review.analysis?.relevant ?? null,
    sentiment: review.analysis?.sentiment ?? null,
    topics: review.analysis?.topics ?? [],
    summary: review.analysis?.summary ?? "",
  }));
}

function fromPosts(dir: string): Item[] {
  const file = join(dir, "data", "posts.jsonl");
  if (!existsSync(file)) return [];
  const items: Item[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let post: Record<string, any>;
    try {
      post = JSON.parse(line);
    } catch {
      continue;
    }
    const key = String(post.id || post.code || post.url || "");
    if (!key) continue;
    const analysis = post.analysis && typeof post.analysis === "object" ? post.analysis : null;
    const parent = post.parent && typeof post.parent === "object" ? post.parent : null;
    items.push({
      source: "threads",
      id: `threads:${key}`,
      published_at: post.published_at ?? null,
      author: post.username ? `@${post.username}` : "",
      place: parent?.username ? `ответ @${parent.username}` : "Threads",
      text: String(post.text || ""),
      rating: null,
      url: String(post.url || ""),
      org_answered: false,
      reply_to: String(parent?.text || ""),
      relevant: typeof analysis?.relevant === "boolean" ? analysis.relevant : null,
      sentiment: ["positive", "neutral", "negative"].includes(analysis?.sentiment) ? analysis.sentiment : null,
      topics: Array.isArray(analysis?.topics) ? analysis.topics.map(String) : [],
      summary: String(analysis?.summary || ""),
    });
  }
  return items;
}

/** All mentions from both scrapers, newest first. */
export function loadItems(root: string): { items: Item[]; threads_root: string | null } {
  const dir = threadsRoot(root);
  const items = [...fromReviews(root), ...(dir ? fromPosts(dir) : [])];
  items.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  return { items, threads_root: dir };
}

export function inPeriod(items: Item[], hours: number): Item[] {
  if (!hours || hours <= 0) return items;
  const cutoff = Date.now() - hours * 3600 * 1000;
  return items.filter((item) => {
    const ms = Date.parse(String(item.published_at || ""));
    return !Number.isNaN(ms) && ms >= cutoff;
  });
}
