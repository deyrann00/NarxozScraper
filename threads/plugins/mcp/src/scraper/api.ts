import { parsePost, type Post } from "./parse.js";

const API_BASE = "https://graph.threads.com/v1.0/keyword_search";
const FIELDS =
  "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply";

export async function searchKeyword(
  token: string,
  query: string,
  limit: number,
  hours: number
): Promise<Post[]> {
  const since = Math.floor(Date.now() / 1000 - Math.max(1, hours) * 3600);
  const posts: Post[] = [];
  for (const searchType of ["RECENT", "TOP"] as const) {
    const params = new URLSearchParams({
      q: query.replace(/^#/, ""),
      search_type: searchType,
      search_mode: query.startsWith("#") ? "TAG" : "KEYWORD",
      fields: FIELDS,
      limit: String(Math.min(limit, 100)),
      since: String(since),
      access_token: token,
    });
    const response = await fetch(`${API_BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Threads API ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as { data?: unknown[] };
    for (const item of payload.data || []) {
      const parsed = parsePost(item, query, `threads_api:${searchType.toLowerCase()}`);
      if (parsed) {
        posts.push(parsed);
      }
    }
    if (posts.length >= limit) {
      break;
    }
  }
  return posts.slice(0, limit);
}
