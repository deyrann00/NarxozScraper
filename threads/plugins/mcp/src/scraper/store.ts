import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./config.js";
import type { Post } from "./parse.js";

function key(post: Post): string {
  return String(post.id || post.code || post.url || "");
}

export function loadExisting(root: string): Record<string, Post> {
  const file = paths(root).postsJsonl;
  const posts: Record<string, Post> = {};
  if (!existsSync(file)) {
    return posts;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const item = JSON.parse(line) as Post;
    const id = key(item);
    if (id) {
      posts[id] = item;
    }
  }
  return posts;
}

export function mergePosts(existing: Record<string, Post>, incoming: Post[]): [Post[], number] {
  let newCount = 0;
  for (const post of incoming) {
    const id = key(post);
    if (!id) {
      continue;
    }
    const previous = existing[id] || {};
    if (!existing[id]) {
      newCount += 1;
    }
    const merged: Post = { ...previous, ...post };
    if (!String(post.text || "").trim() && previous.text) {
      merged.text = previous.text;
    }
    const prevParent = previous.parent as Post | undefined;
    const nextParent = post.parent as Post | undefined;
    if (!nextParent?.text && prevParent?.text) {
      merged.parent = prevParent;
      merged.is_reply = true;
    }
    existing[id] = merged;
  }
  const ordered = Object.values(existing).sort((a, b) =>
    String(b.published_at || b.scraped_at || "").localeCompare(String(a.published_at || a.scraped_at || ""))
  );
  return [ordered, newCount];
}

export function savePosts(root: string, posts: Post[]): void {
  const { postsJsonl, postsCsv, data } = paths(root);
  mkdirSync(data, { recursive: true });
  writeFileSync(
    postsJsonl,
    posts.map((post) => JSON.stringify(post)).join("\n") + (posts.length ? "\n" : ""),
    "utf8"
  );
  const fields = [
    "id",
    "code",
    "url",
    "username",
    "text",
    "published_at",
    "like_count",
    "reply_count",
    "repost_count",
    "query",
    "source",
    "scraped_at",
  ];
  const rows = [
    fields.join(","),
    ...posts.map((post) =>
      fields
        .map((field) => `"${String(post[field] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  writeFileSync(postsCsv, rows.join("\n"), "utf8");
}

export function saveRun(root: string, summary: Record<string, unknown>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const file = join(paths(root).runs, `${stamp}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2), "utf8");
  return file;
}

export function lookbackPosts(posts: Post[], hours: number): Post[] {
  const cutoff = Date.now() - Math.max(1, hours) * 3600 * 1000;
  return posts.filter((post) => {
    const raw = String(post.published_at || "");
    if (!raw) {
      return false;
    }
    const ms = Date.parse(raw.replace("Z", "+00:00"));
    return !Number.isNaN(ms) && ms >= cutoff;
  });
}
