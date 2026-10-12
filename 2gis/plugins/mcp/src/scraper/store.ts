import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Branch } from "./branches.js";
import { paths } from "./config.js";
import type { Review } from "./parse.js";

/** Rows saved before reply threads were collected carry `official_answer` and `comments_count`. */
function upgrade(item: Record<string, any>): Review {
  if (Array.isArray(item.replies)) {
    return item as Review;
  }
  const { official_answer: answer, comments_count: count, ...rest } = item;
  return {
    ...rest,
    replies_count: Number(count) || 0,
    replies: answer?.text
      ? [{ author: answer.org_name || "", from_org: true, text: answer.text, published_at: answer.published_at ?? null }]
      : [],
  } as Review;
}

export function loadExisting(root: string): Record<string, Review> {
  const file = paths(root).reviewsJsonl;
  const reviews: Record<string, Review> = {};
  if (!existsSync(file)) {
    return reviews;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const item = upgrade(JSON.parse(line));
      if (item.id) {
        reviews[item.id] = item;
      }
    } catch {
      continue;
    }
  }
  return reviews;
}

export function mergeReviews(existing: Record<string, Review>, incoming: Review[]): [Review[], number] {
  let newCount = 0;
  for (const review of incoming) {
    if (!existing[review.id]) {
      newCount += 1;
    }
    existing[review.id] = { ...existing[review.id], ...review };
  }
  const ordered = Object.values(existing).sort((a, b) =>
    String(b.published_at || b.scraped_at || "").localeCompare(String(a.published_at || a.scraped_at || ""))
  );
  return [ordered, newCount];
}

export function saveReviews(root: string, reviews: Review[]): void {
  const { reviewsJsonl, reviewsCsv } = paths(root);
  writeFileSync(
    reviewsJsonl,
    reviews.map((review) => JSON.stringify(review)).join("\n") + (reviews.length ? "\n" : ""),
    "utf8"
  );
  const fields: (keyof Review | "relevant" | "sentiment" | "topics" | "summary")[] = [
    "id",
    "branch_id",
    "branch_name",
    "rating",
    "author",
    "text",
    "published_at",
    "likes_count",
    "replies_count",
    "replies",
    "url",
    "scraped_at",
    "relevant",
    "sentiment",
    "topics",
    "summary",
  ];
  const cell = (review: Review, field: (typeof fields)[number]) => {
    const value =
      field === "replies"
        ? review.replies.map((reply) => `${reply.author}: ${reply.text}`).join("\n---\n")
        : field === "relevant" || field === "sentiment" || field === "summary"
          ? review.analysis?.[field]
          : field === "topics"
            ? review.analysis?.topics.join("; ")
            : review[field];
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  };
  const rows = [fields.join(","), ...reviews.map((review) => fields.map((f) => cell(review, f)).join(","))];
  writeFileSync(reviewsCsv, rows.join("\n"), "utf8");
}

export function loadBranches(root: string): Branch[] {
  const file = paths(root).branches;
  if (!existsSync(file)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as Branch[]) : [];
  } catch {
    return [];
  }
}

export function saveBranches(root: string, branches: Branch[]): void {
  writeFileSync(paths(root).branches, JSON.stringify(branches, null, 2) + "\n", "utf8");
}

export function saveRun(root: string, summary: Record<string, unknown>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const file = join(paths(root).runs, `${stamp}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2), "utf8");
  return file;
}

export function lookbackReviews(reviews: Review[], hours: number): Review[] {
  const cutoff = Date.now() - Math.max(1, hours) * 3600 * 1000;
  return reviews.filter((review) => {
    const ms = Date.parse(String(review.published_at || ""));
    return !Number.isNaN(ms) && ms >= cutoff;
  });
}
