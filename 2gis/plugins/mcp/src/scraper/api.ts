import type { Branch } from "./branches.js";
import { fetchJson, sleep } from "./http.js";
import { parseReply, parseReview, type Reply, type Review } from "./parse.js";

const API_BASE = "https://public-api.reviews.2gis.com/2.0";
/** The public key 2GIS ships in its web app; used when no page yielded a fresh one. */
export const FALLBACK_API_KEY = "6e7e1929-4ea9-4a5d-8c05-d601860389bd";
const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 300;

type Payload = {
  meta?: {
    code?: number;
    message?: string;
    next_link?: string;
    branch_rating?: number;
    branch_reviews_count?: number;
  };
  reviews?: unknown[];
  comments?: unknown[];
};

export type BranchReviews = {
  reviews: Review[];
  rating: number | null;
  reviews_count: number | null;
  errors: string[];
};

/** Every visible reply under one review, oldest first: the organisation's and other users'. */
async function fetchReplies(reviewId: string, key: string, locale: string): Promise<Reply[]> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), key, locale });
  let url: string | undefined = `${API_BASE}/reviews/${reviewId}/comments?${params.toString()}`;
  const replies: Reply[] = [];
  while (url) {
    const payload: Payload = await fetchJson<Payload>(url);
    if (payload.meta?.code !== 200) {
      throw new Error(`2GIS comments API ${payload.meta?.code}: ${payload.meta?.message || "unknown error"}`);
    }
    const items = payload.comments || [];
    for (const item of items) {
      const reply = parseReply(item);
      if (reply) {
        replies.push(reply);
      }
    }
    const next = payload.meta.next_link;
    url = items.length && next?.startsWith(API_BASE) ? next : undefined;
    if (url) {
      await sleep(PAGE_DELAY_MS);
    }
  }
  return replies;
}

/**
 * Newest-first reviews of one branch. Paging stops at `limit`, or once a page
 * reaches past `sinceMs` (pass `null` to page all the way to `limit`).
 */
export async function fetchBranchReviews(
  branch: Branch,
  key: string,
  locale: string,
  limit: number,
  sinceMs: number | null
): Promise<BranchReviews> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    key,
    locale,
    sort_by: "date_created",
    rated: "true",
    fields: "meta.branch_rating,meta.branch_reviews_count,meta.total_count",
  });
  let url: string | undefined = `${API_BASE}/branches/${branch.id}/reviews?${params.toString()}`;
  const result: BranchReviews = { reviews: [], rating: null, reviews_count: null, errors: [] };

  while (url && result.reviews.length < limit) {
    const payload: Payload = await fetchJson<Payload>(url);
    if (payload.meta?.code !== 200) {
      throw new Error(`2GIS reviews API ${payload.meta?.code}: ${payload.meta?.message || "unknown error"}`);
    }
    result.rating ??= payload.meta.branch_rating ?? null;
    result.reviews_count ??= payload.meta.branch_reviews_count ?? null;

    const items = payload.reviews || [];
    let reachedOlder = false;
    for (const item of items) {
      const review = parseReview(item, branch);
      if (!review) {
        continue;
      }
      // The list embeds just the official answer; a longer thread needs its own request.
      if (review.replies_count > review.replies.length) {
        try {
          await sleep(PAGE_DELAY_MS);
          review.replies = await fetchReplies(review.id, key, locale);
          review.replies_count = review.replies.length;
        } catch (err) {
          result.errors.push(`replies of review ${review.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      result.reviews.push(review);
      if (sinceMs !== null && review.published_at && Date.parse(review.published_at) < sinceMs) {
        reachedOlder = true;
      }
    }
    const next = payload.meta.next_link;
    url = items.length && !reachedOlder && next?.startsWith(API_BASE) ? next : undefined;
    if (url) {
      await sleep(PAGE_DELAY_MS);
    }
  }
  result.reviews = result.reviews.slice(0, limit);
  return result;
}
