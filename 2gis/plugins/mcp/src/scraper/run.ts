import { analyzeReviews } from "./analyze.js";
import { FALLBACK_API_KEY, fetchBranchReviews } from "./api.js";
import { discoverBranches } from "./branches.js";
import { loadConfig } from "./config.js";
import type { Review } from "./parse.js";
import {
  loadBranches,
  loadExisting,
  lookbackReviews,
  mergeReviews,
  saveBranches,
  saveReviews,
  saveRun,
} from "./store.js";
import { writeHtml } from "./view.js";

/**
 * One collection pass. By default each branch is read back to the start of the
 * weekly window; `full` ignores the window and reads up to `max_reviews_per_branch`.
 */
export async function scrapeOnce(root: string, full = false): Promise<Record<string, unknown>> {
  const cfg = loadConfig(root);
  const hours = cfg.lookback_hours || 24;
  const weekHours = cfg.week_hours || 168;
  const sinceMs = full ? null : Date.now() - Math.max(hours, weekHours) * 3600 * 1000;

  const discovery = await discoverBranches(cfg);
  const errors = [...discovery.errors];
  // 2GIS search being down should not stop a daily run: reuse the last known branch list.
  const branches = discovery.branches.length ? discovery.branches : loadBranches(root);
  if (!branches.length) {
    throw new Error(
      [
        "No 2GIS branches to scrape.",
        "Add branch ids or firm URLs to `branches` in config.json, or fix `queries` / `name_filters`.",
        ...errors,
      ].join("\n")
    );
  }
  const key = cfg.review_api_key.trim() || discovery.apiKey || FALLBACK_API_KEY;

  const collected: Review[] = [];
  const perBranch: Record<string, unknown>[] = [];
  for (const branch of branches) {
    let fetched = 0;
    try {
      const result = await fetchBranchReviews(branch, key, cfg.locale, cfg.max_reviews_per_branch, sinceMs);
      branch.rating = result.rating ?? branch.rating;
      branch.reviews_count = result.reviews_count ?? branch.reviews_count;
      fetched = result.reviews.length;
      collected.push(...result.reviews);
      errors.push(...result.errors.map((message) => `${branch.name} (${branch.id}): ${message}`));
    } catch (err) {
      errors.push(`${branch.name} (${branch.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
    perBranch.push({
      id: branch.id,
      name: branch.name,
      address: branch.address,
      rating: branch.rating,
      reviews_count: branch.reviews_count,
      fetched,
      url: branch.url,
    });
  }
  saveBranches(root, branches);

  const [merged, newCount] = mergeReviews(loadExisting(root), collected);
  saveReviews(root, merged);
  // Only new or edited reviews reach the LLM; a failing LLM never fails the scrape.
  let analysis: Record<string, unknown> | null = null;
  try {
    const result = await analyzeReviews(root);
    errors.push(...result.errors);
    analysis = {
      model: result.model,
      analyzed: result.analyzed,
      relevant: result.relevant,
      irrelevant: result.irrelevant,
      by_sentiment: result.by_sentiment,
    };
  } catch (err) {
    errors.push(`LLM: ${err instanceof Error ? err.message : String(err)}`);
  }
  const summary = {
    ran_at: new Date().toISOString(),
    timezone: cfg.timezone,
    source: "2gis_reviews_api",
    mode: full ? "full" : "recent",
    queries: cfg.queries,
    branches: perBranch,
    lookback_hours: hours,
    week_hours: weekHours,
    found: collected.length,
    last_24h: lookbackReviews(merged, hours).length,
    last_7d: lookbackReviews(merged, weekHours).length,
    new: newCount,
    total: merged.length,
    analysis,
    errors,
    engine: "typescript",
    dashboard: writeHtml(root),
  };
  saveRun(root, summary);
  return summary;
}
