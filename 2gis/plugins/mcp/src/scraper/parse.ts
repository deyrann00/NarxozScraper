import type { Branch } from "./branches.js";

export type Reply = {
  author: string;
  /** Written by the organisation (Narxoz) rather than by a 2GIS user. */
  from_org: boolean;
  text: string;
  published_at: string | null;
};

export type Sentiment = "positive" | "neutral" | "negative";

/** What the LLM (or the star-rating fallback) decided about one review. */
export type Analysis = {
  /** Worth the administration's attention: not spam, not empty, about Narxoz. */
  relevant: boolean;
  sentiment: Sentiment;
  topics: string[];
  /** One-line gist in Russian. */
  summary: string;
  /** OpenRouter model slug, or "rating-fallback" when no LLM was used. */
  model: string;
  /** sha1 of the text the analysis was made for; a mismatch means the review was edited. */
  text_hash: string;
  analyzed_at: string;
};

export type Review = {
  id: string;
  branch_id: string;
  branch_name: string;
  branch_address: string;
  rating: number | null;
  text: string;
  author: string;
  author_reviews_count: number | null;
  published_at: string | null;
  edited_at: string | null;
  likes_count: number;
  replies_count: number;
  replies: Reply[];
  photos_count: number;
  is_verified: boolean;
  url: string;
  source: string;
  scraped_at: string;
  analysis?: Analysis;
};

/** 2GIS returns local offsets (+07:00); the archive is kept in UTC like the Threads one. */
function isoUtc(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** One entry of a review's comment thread, or of the `official_answer` embedded in a review. */
export function parseReply(item: unknown): Reply | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const raw = item as Record<string, any>;
  const text = String(raw.text || "").trim();
  if (!text || raw.is_hidden) {
    return undefined;
  }
  const org = String(raw.org?.name || raw.org_name || "").trim();
  return {
    author: org || String(raw.user?.name || "").trim(),
    from_org: Boolean(org || raw.is_official_answer),
    text,
    published_at: isoUtc(raw.date_created),
  };
}

/**
 * `replies` holds only the embedded official answer here; when `replies_count`
 * is larger, the caller loads the whole thread.
 */
export function parseReview(item: unknown, branch: Branch): Review | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const raw = item as Record<string, any>;
  const id = String(raw.id || "");
  if (!id || raw.is_hidden) {
    return undefined;
  }
  const answer = parseReply(raw.official_answer);
  return {
    id,
    branch_id: branch.id,
    branch_name: branch.name,
    branch_address: branch.address,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    text: String(raw.text || "").trim(),
    author: String(raw.user?.name || "").trim(),
    author_reviews_count: typeof raw.user?.reviews_count === "number" ? raw.user.reviews_count : null,
    published_at: isoUtc(raw.date_created),
    edited_at: isoUtc(raw.date_edited),
    likes_count: Number(raw.likes_count) || 0,
    replies_count: Number(raw.comments_count) || 0,
    replies: answer ? [{ ...answer, from_org: true }] : [],
    photos_count: Array.isArray(raw.photos) ? raw.photos.length : 0,
    is_verified: Boolean(raw.is_verified),
    url: `${branch.url}/tab/reviews/review/${id}`,
    source: "2gis_reviews_api",
    scraped_at: new Date().toISOString(),
  };
}
