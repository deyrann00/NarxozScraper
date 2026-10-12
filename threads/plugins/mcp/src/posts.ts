import { existsSync, readFileSync } from "node:fs";
import { postsPath } from "./repo.js";

export type SavedPost = {
  code?: string;
  username?: string;
  text?: string;
  url?: string;
  published_at?: string | null;
  scraped_at?: string;
  like_count?: number | null;
  reply_count?: number | null;
  repost_count?: number | null;
  is_reply?: boolean;
  parent?: { username?: string; text?: string; url?: string } | null;
};

function parseTime(value: unknown): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(String(value).replace("Z", "+00:00"));
  return Number.isNaN(ms) ? null : ms;
}

export function loadPosts(root: string): SavedPost[] {
  const file = postsPath(root);
  if (!existsSync(file)) {
    return [];
  }
  const posts: SavedPost[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      posts.push(JSON.parse(line) as SavedPost);
    } catch {
      continue;
    }
  }
  posts.sort((a, b) => {
    const left = String(a.published_at || a.scraped_at || "");
    const right = String(b.published_at || b.scraped_at || "");
    return right.localeCompare(left);
  });
  return posts;
}

export function recentPosts(root: string, hours: number, limit: number): SavedPost[] {
  const cap = Math.max(1, Math.min(limit, 100));
  let posts = loadPosts(root);
  if (hours > 0) {
    const cutoff = Date.now() - hours * 3600 * 1000;
    posts = posts.filter((post) => {
      const ms = parseTime(post.published_at);
      return ms !== null && ms >= cutoff;
    });
  }
  return posts.slice(0, cap).map((post) => ({
    code: post.code || "",
    username: post.username || "",
    text: post.text || "",
    url: post.url || "",
    published_at: post.published_at || null,
    like_count: post.like_count ?? 0,
    reply_count: post.reply_count ?? 0,
    repost_count: post.repost_count ?? 0,
    is_reply: Boolean(post.is_reply),
    parent: post.parent
      ? {
          username: post.parent.username || "",
          text: post.parent.text || "",
          url: post.parent.url || "",
        }
      : null,
  }));
}
