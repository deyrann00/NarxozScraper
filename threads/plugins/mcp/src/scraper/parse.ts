export type Post = Record<string, unknown>;

const POST_URL_RE =
  /https:\/\/www\.threads\.(?:com|net)\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/g;

const ANESTHESIA = [
  "наркоз",
  "анестез",
  "эпидурал",
  "роддом",
  "босан",
  "кесар",
  "нархоз сал",
  "общий нархоз",
  "общ нархоз",
  "жартылай нархоз",
  "кс бол",
  "кс планов",
];

const UNIVERSITY = [
  "университет",
  "university",
  "студент",
  "грант",
  "магистр",
  "бакалавр",
  "бизнес шко",
  "narxoz",
  "mba",
  "оқи",
  "поступил",
  "препод",
  "семестр",
  "диплом",
  "кафедр",
  "факультет",
  "нархоз университет",
];

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function fromUnix(value: unknown): string | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  const seconds = n > 10_000_000_000 ? n / 1000 : n;
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function searchUrl(query: string, filterName: string): string {
  const url = `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=default`;
  return filterName === "recent" ? `${url}&filter=recent` : url;
}

export function mentionsNarxoz(text: string | undefined, queries: string[]): string[] {
  const blob = (text || "").toLowerCase();
  return queries.filter((query) => {
    const needle = query.replace(/^#/, "").toLowerCase();
    return Boolean(needle) && blob.includes(needle);
  });
}

export function isUniversityMention(
  text: string | undefined,
  username: string | undefined,
  queries: string[]
): string[] {
  const hits = mentionsNarxoz(text, queries);
  if (!hits.length) {
    return [];
  }
  const user = (username || "").toLowerCase();
  if (user.includes("narxoz") || user.includes("нархоз")) {
    return hits;
  }
  const blob = (text || "").toLowerCase();
  if (UNIVERSITY.some((word) => blob.includes(word))) {
    return hits;
  }
  if (ANESTHESIA.some((word) => blob.includes(word))) {
    return [];
  }
  return hits;
}

function asInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const digits = String(value).trim().split(/\s+/)[0]?.replace(/,/g, "");
  if (digits && /^\d+$/.test(digits)) {
    return Number(digits);
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function codeFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = /\/post\/([A-Za-z0-9_-]+)/.exec(url);
  return match?.[1];
}

function avatarUrl(user: Record<string, unknown>): string | undefined {
  if (user.profile_pic_url) {
    return String(user.profile_pic_url);
  }
  const versions = user.hd_profile_pic_versions;
  if (Array.isArray(versions) && versions.length) {
    const last = versions[versions.length - 1] as Record<string, unknown>;
    if (last?.url) {
      return String(last.url);
    }
  }
  return undefined;
}

function bestImage(node: Record<string, unknown>): string | undefined {
  const versions = node.image_versions2 as Record<string, unknown> | undefined;
  const candidates = (versions?.candidates as Record<string, unknown>[] | undefined) || [];
  if (!candidates.length) {
    return undefined;
  }
  const best = candidates.reduce((a, b) =>
    Number(a.width || 0) >= Number(b.width || 0) ? a : b
  );
  return best.url ? String(best.url) : undefined;
}

function imageUrls(post: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const carousel = post.carousel_media;
  if (Array.isArray(carousel) && carousel.length) {
    for (const media of carousel) {
      if (media && typeof media === "object") {
        const url = bestImage(media as Record<string, unknown>);
        if (url) {
          urls.push(url);
        }
      }
    }
  } else {
    const url = bestImage(post);
    if (url) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

export function parentCard(post: Post): Post {
  return {
    code: post.code || "",
    username: post.username || "",
    text: post.text || "",
    url: post.url || "",
    avatar: post.avatar || "",
    avatar_url: post.avatar_url || "",
    images: post.images || [],
    image_urls: post.image_urls || [],
    published_at: post.published_at,
    verified: Boolean(post.verified),
    like_count: post.like_count || 0,
    reply_count: post.reply_count || 0,
    repost_count: post.repost_count || 0,
  };
}

function normalize(post: Post): Post | undefined {
  if (!post.id && !post.code && !post.url) {
    return undefined;
  }
  post.text = String(post.text || "").trim();
  post.username = post.username || "";
  post.scraped_at = utcNow();
  post.image_urls = ((post.image_urls as string[]) || []).filter(Boolean);
  post.images = post.images || [];
  post.avatar = post.avatar || "";
  post.is_reply = Boolean(post.is_reply || post.reply_to || post.parent);
  if (post.parent && typeof post.parent !== "object") {
    post.parent = undefined;
  }
  for (const field of ["like_count", "reply_count", "repost_count"] as const) {
    post[field] = asInt(post[field]);
  }
  if (typeof post.url === "string") {
    post.url = post.url.replace("threads.net", "threads.com");
  }
  return post;
}

export function parsePost(item: unknown, query: string, source: string): Post | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const rec = item as Record<string, unknown>;
  if (rec.permalink || (rec.text && rec.username && rec.id)) {
    const url = String(rec.permalink || rec.url || "");
    return normalize({
      id: rec.id,
      code: codeFromUrl(url),
      url,
      username: rec.username,
      text: rec.text || "",
      published_at: rec.timestamp || rec.published_at,
      like_count: rec.like_count || rec.likeCount,
      reply_count: rec.reply_count || rec.replyCount,
      repost_count: rec.repost_count || rec.repostCount,
      query,
      source,
    });
  }

  const post = (rec.post && typeof rec.post === "object" ? rec.post : rec) as Record<string, unknown>;
  const caption = (post.caption && typeof post.caption === "object" ? post.caption : {}) as Record<
    string,
    unknown
  >;
  const user = (post.user && typeof post.user === "object" ? post.user : {}) as Record<string, unknown>;
  const code = post.code as string | undefined;
  const username = String(user.username || post.username || "");
  const text = String(caption.text || post.text || "");
  const publishedAt = fromUnix(post.taken_at) || (post.published_at as string | undefined);
  const threadsInfo = post.text_post_app_info;
  const isThreads = Boolean(threadsInfo && typeof threadsInfo === "object") || Boolean(post.taken_at);
  if (!isThreads || !publishedAt) {
    return undefined;
  }
  if (!code && !text) {
    return undefined;
  }
  const reply = (threadsInfo && typeof threadsInfo === "object" ? threadsInfo : {}) as Record<
    string,
    unknown
  >;
  const replyToAuthor = reply.reply_to_author as Record<string, unknown> | undefined;
  const replyTo = replyToAuthor && typeof replyToAuthor === "object" ? String(replyToAuthor.username || "") : undefined;
  let parent: Post | undefined;
  if (reply.quoted_post && typeof reply.quoted_post === "object") {
    parent = parentCard(parsePost({ post: reply.quoted_post }, query, source) || {});
    if (!parent.text && !parent.username) {
      parent = undefined;
    }
  }
  return normalize({
    id: post.id || post.pk || code,
    code,
    url: username && code ? `https://www.threads.com/@${username}/post/${code}` : undefined,
    username,
    full_name: user.full_name || "",
    verified: Boolean(user.is_verified),
    avatar_url: avatarUrl(user),
    image_urls: imageUrls(post),
    text,
    published_at: publishedAt,
    like_count: post.like_count,
    reply_count: asInt(reply.direct_reply_count || rec.view_replies_cta_string),
    repost_count: post.repost_count || reply.repost_count,
    query,
    source,
    is_reply: Boolean(replyTo),
    reply_to: replyTo || undefined,
    parent,
  });
}

function walk(node: unknown, visitObj: (obj: Record<string, unknown>) => void, seen: WeakSet<object>): void {
  if (!node || typeof node !== "object" || seen.has(node)) {
    return;
  }
  seen.add(node);
  if (Array.isArray(node)) {
    for (const value of node) {
      walk(value, visitObj, seen);
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  visitObj(obj);
  for (const value of Object.values(obj)) {
    walk(value, visitObj, seen);
  }
}

export function walkPosts(payload: unknown): Post[] {
  const found: Post[] = [];
  walk(
    payload,
    (node) => {
      const raw = node.post && typeof node.post === "object" ? (node.post as Record<string, unknown>) : undefined;
      if (raw && raw.code && (raw.taken_at || raw.text_post_app_info)) {
        found.push(node);
      } else if (node.code && node.taken_at && node.user && typeof node.user === "object") {
        found.push({ post: node });
      }
    },
    new WeakSet()
  );
  return found;
}

export function walkThreadGroups(payload: unknown): unknown[][] {
  const groups: unknown[][] = [];
  walk(
    payload,
    (node) => {
      if (Array.isArray(node.thread_items) && node.thread_items.length) {
        groups.push(node.thread_items);
      }
    },
    new WeakSet()
  );
  return groups;
}

export function parseThreadGroup(items: unknown[], query: string, source: string): Post[] {
  const parsed: Post[] = [];
  for (const item of items) {
    const post = parsePost(item, query, source);
    if (post) {
      parsed.push(post);
    }
  }
  if (parsed.length >= 2) {
    const card = parentCard(parsed[0]);
    for (const child of parsed.slice(1)) {
      child.is_reply = true;
      child.reply_to = child.reply_to || parsed[0].username;
      const parent = child.parent as Post | undefined;
      if (!parent?.text) {
        child.parent = card;
      }
    }
  }
  return parsed;
}

function mergeParsed(posts: Record<string, Post>, parsed: Post): void {
  let key = String(parsed.id || parsed.code || parsed.url || "");
  if (!key) {
    return;
  }
  let current = posts[key];
  if (!current && parsed.code) {
    const code = String(parsed.code);
    for (const [existingKey, existing] of Object.entries(posts)) {
      if (String(existing.code || "") === code) {
        current = existing;
        key = existingKey;
        break;
      }
    }
  }
  if (!current) {
    posts[key] = parsed;
    return;
  }
  if (parsed.text && !current.text) {
    current.text = parsed.text;
  }
  if ((parsed.image_urls as string[])?.length && !(current.image_urls as string[])?.length) {
    current.image_urls = parsed.image_urls;
  }
  if (parsed.avatar_url && !current.avatar_url) {
    current.avatar_url = parsed.avatar_url;
    current.verified = parsed.verified;
  }
  const parsedParent = parsed.parent as Post | undefined;
  const currentParent = current.parent as Post | undefined;
  if (parsedParent && !currentParent?.text) {
    current.parent = parsedParent;
    current.is_reply = true;
  }
  if (parsed.reply_to && !current.reply_to) {
    current.reply_to = parsed.reply_to;
    current.is_reply = true;
  }
  posts[key] = current;
}

export function ingestPayload(
  payload: unknown,
  query: string,
  source: string,
  posts: Record<string, Post>
): void {
  const grouped = new Set<string>();
  for (const group of walkThreadGroups(payload)) {
    for (const post of parseThreadGroup(group, query, source)) {
      mergeParsed(posts, post);
      if (post.code) {
        grouped.add(String(post.code));
      }
    }
  }
  for (const raw of walkPosts(payload)) {
    const post = parsePost(raw, query, source);
    if (post && !grouped.has(String(post.code || ""))) {
      mergeParsed(posts, post);
    }
  }
}

export function payloadsFromHtml(html: string): unknown[] {
  const payloads: unknown[] = [];
  const marker = '<script type="application/json"';
  let start = 0;
  while (true) {
    const idx = html.indexOf(marker, start);
    if (idx < 0) {
      break;
    }
    const openEnd = html.indexOf(">", idx);
    const close = html.indexOf("</script>", openEnd);
    if (openEnd < 0 || close < 0) {
      break;
    }
    const raw = html.slice(openEnd + 1, close);
    start = close + 9;
    if (!raw.includes("thread_items") && !raw.includes('"caption"')) {
      continue;
    }
    try {
      payloads.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return payloads;
}

export { POST_URL_RE };
