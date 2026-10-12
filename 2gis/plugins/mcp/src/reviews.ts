import type { Review, Sentiment } from "./scraper/parse.js";
import { loadExisting, lookbackReviews, mergeReviews } from "./scraper/store.js";

/** Saved reviews, newest first, trimmed to the fields a summary needs. */
export function recentReviews(
  root: string,
  hours: number,
  limit: number,
  maxRating?: number,
  sentiment?: Sentiment,
  includeIrrelevant = false
) {
  const cap = Math.max(1, Math.min(limit, 200));
  let [reviews] = mergeReviews(loadExisting(root), []);
  if (hours > 0) {
    reviews = lookbackReviews(reviews, hours);
  }
  if (maxRating !== undefined) {
    reviews = reviews.filter((review: Review) => review.rating !== null && review.rating <= maxRating);
  }
  if (!includeIrrelevant) {
    reviews = reviews.filter((review) => review.analysis?.relevant !== false);
  }
  if (sentiment) {
    reviews = reviews.filter((review) => review.analysis?.sentiment === sentiment);
  }
  return reviews.slice(0, cap).map((review) => ({
    id: review.id,
    branch: review.branch_name,
    branch_address: review.branch_address,
    rating: review.rating,
    author: review.author,
    text: review.text,
    url: review.url,
    published_at: review.published_at,
    edited_at: review.edited_at ?? null,
    likes_count: review.likes_count ?? 0,
    photos_count: review.photos_count ?? 0,
    replies_count: review.replies_count,
    replies: review.replies,
    relevant: review.analysis?.relevant ?? null,
    sentiment: review.analysis?.sentiment ?? null,
    topics: review.analysis?.topics ?? [],
    summary: review.analysis?.summary ?? "",
  }));
}
