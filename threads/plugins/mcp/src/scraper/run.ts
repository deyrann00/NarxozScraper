import { apiToken, loadConfig, searchQueries } from "./config.js";
import { isUniversityMention, type Post } from "./parse.js";
import { searchKeyword } from "./api.js";
import { LoginRequired, searchBrowser } from "./browser.js";
import { loadExisting, lookbackPosts, mergePosts, savePosts, saveRun } from "./store.js";

export async function scrapeOnce(root: string, forceBrowser = false): Promise<Record<string, unknown>> {
  const cfg = loadConfig(root);
  const queries = searchQueries(cfg);
  const hours = cfg.lookback_hours || 24;
  const weekHours = cfg.week_hours || 168;
  const collectHours = Math.max(hours, weekHours);
  const collected: Post[] = [];
  const errors: string[] = [];
  let source = "threads_browser";
  const token = apiToken();

  if (token && !forceBrowser) {
    source = "threads_api";
    for (const query of queries) {
      try {
        const found = await searchKeyword(token, query, cfg.max_posts_per_query, collectHours);
        collected.push(...found);
      } catch (err) {
        errors.push(`API query ${query} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!collected.length) {
      source = "threads_browser";
    }
  }

  if (source === "threads_browser" || forceBrowser) {
    source = "threads_browser";
    for (const query of queries) {
      try {
        const found = await searchBrowser(root, query, cfg);
        collected.push(...found);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        if (err instanceof LoginRequired) {
          break;
        }
      }
    }
  }

  const relevant: Post[] = [];
  const seen = new Set<string>();
  for (const post of collected) {
    const id = String(post.id || post.code || post.url || "");
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    let hits = isUniversityMention(String(post.text || ""), String(post.username || ""), queries);
    const parent = (post.parent && typeof post.parent === "object" ? post.parent : {}) as Post;
    if (!hits.length) {
      hits = isUniversityMention(String(parent.text || ""), String(parent.username || ""), queries);
    }
    const username = String(post.username || "").toLowerCase();
    if (!hits.length && post.published_at && (username.includes("narxoz") || username.includes("нархоз"))) {
      hits = [`@${post.username}`];
    }
    if (!hits.length) {
      continue;
    }
    post.matched_keywords = hits;
    relevant.push(post);
  }

  const existing = loadExisting(root);
  const [merged, newCount] = mergePosts(existing, relevant);
  savePosts(root, merged);
  const summary = {
    ran_at: new Date().toISOString(),
    timezone: cfg.timezone,
    source,
    queries,
    lookback_hours: hours,
    week_hours: weekHours,
    found: relevant.length,
    last_24h: lookbackPosts(merged, hours).length,
    last_7d: lookbackPosts(merged, weekHours).length,
    new: newCount,
    total: merged.length,
    errors,
    engine: "typescript",
  };
  saveRun(root, summary);
  return summary;
}
