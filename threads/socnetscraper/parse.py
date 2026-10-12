from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

THREADS_HOSTS = ("https://www.threads.com", "https://www.threads.net")
POST_URL_RE = re.compile(
    r"https://www\.threads\.(?:com|net)/@([A-Za-z0-9._]+)/post/([A-Za-z0-9_-]+)"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def from_unix(value: Any) -> str | None:
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    if ts > 10_000_000_000:
        ts //= 1000
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def search_url(query: str, filter_name: str) -> str:
    encoded = quote(query, safe="")
    url = f"https://www.threads.com/search?q={encoded}&serp_type=default"
    if filter_name == "recent":
        url += "&filter=recent"
    return url


# People often write anesthesia (наркоз) as "нархоз". Drop those unless the
# same text also talks about the university.
_ANESTHESIA = (
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
)
_UNIVERSITY = (
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
)


def mentions_narxoz(text: str | None, queries: list[str]) -> list[str]:
    blob = (text or "").casefold()
    hits = []
    for query in queries:
        needle = query.lstrip("#").casefold()
        if needle and needle in blob:
            hits.append(query)
    return hits


def is_university_mention(text: str | None, username: str | None, queries: list[str]) -> list[str]:
    hits = mentions_narxoz(text, queries)
    if not hits:
        return []
    user = (username or "").casefold()
    if any(name in user for name in ("narxoz", "нархоз")):
        return hits
    blob = (text or "").casefold()
    if any(word in blob for word in _UNIVERSITY):
        return hits
    if any(word in blob for word in _ANESTHESIA):
        return []
    return hits


def parse_post(item: dict[str, Any], query: str, source: str) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    if item.get("permalink") or item.get("text") and item.get("username") and item.get("id"):
        url = item.get("permalink") or item.get("url")
        return _normalize(
            {
                "id": item.get("id"),
                "code": _code_from_url(url),
                "url": url,
                "username": item.get("username"),
                "text": item.get("text") or "",
                "published_at": item.get("timestamp") or item.get("published_at"),
                "like_count": item.get("like_count") or item.get("likeCount"),
                "reply_count": item.get("reply_count") or item.get("replyCount"),
                "repost_count": item.get("repost_count") or item.get("repostCount"),
                "query": query,
                "source": source,
            }
        )

    post = item.get("post") if isinstance(item.get("post"), dict) else item
    caption = post.get("caption") if isinstance(post.get("caption"), dict) else {}
    user = post.get("user") if isinstance(post.get("user"), dict) else {}
    code = post.get("code")
    username = user.get("username") or post.get("username")
    text = caption.get("text") or post.get("text") or ""
    published_at = from_unix(post.get("taken_at")) or post.get("published_at")
    threads_info = post.get("text_post_app_info")
    is_threads = isinstance(threads_info, dict) or bool(post.get("taken_at"))
    # Instagram grid/reel objects show up in the same GraphQL tree but are not Threads posts.
    if not is_threads or not published_at:
        return None
    if not code and not text:
        return None
    url = None
    if username and code:
        url = f"https://www.threads.com/@{username}/post/{code}"
    reply = post.get("text_post_app_info") if isinstance(post.get("text_post_app_info"), dict) else {}
    reply_to = None
    if isinstance(reply.get("reply_to_author"), dict):
        reply_to = reply["reply_to_author"].get("username")
    quoted = reply.get("quoted_post") if isinstance(reply.get("quoted_post"), dict) else None
    parent = None
    if quoted:
        parent = parent_card(parse_post({"post": quoted}, query, source) or {})
        if not parent.get("text") and not parent.get("username"):
            parent = None
    return _normalize(
        {
            "id": post.get("id") or post.get("pk") or code,
            "code": code,
            "url": url,
            "username": username,
            "full_name": user.get("full_name") or "",
            "verified": bool(user.get("is_verified")),
            "avatar_url": _avatar_url(user),
            "image_urls": _image_urls(post),
            "text": text,
            "published_at": published_at,
            "like_count": post.get("like_count"),
            "reply_count": _as_int(reply.get("direct_reply_count") or item.get("view_replies_cta_string")),
            "repost_count": post.get("repost_count") or reply.get("repost_count"),
            "query": query,
            "source": source,
            "is_reply": bool(reply_to),
            "reply_to": reply_to,
            "parent": parent,
        }
    )


def _normalize(post: dict[str, Any]) -> dict[str, Any] | None:
    if not post.get("id") and not post.get("code") and not post.get("url"):
        return None
    post["text"] = (post.get("text") or "").strip()
    post["username"] = post.get("username") or ""
    post["scraped_at"] = utc_now()
    post["image_urls"] = [url for url in (post.get("image_urls") or []) if url]
    post["images"] = post.get("images") or []
    post["avatar"] = post.get("avatar") or ""
    post["is_reply"] = bool(post.get("is_reply") or post.get("reply_to") or post.get("parent"))
    if post.get("parent") and not isinstance(post["parent"], dict):
        post["parent"] = None
    for field in ("like_count", "reply_count", "repost_count"):
        post[field] = _as_int(post.get(field))
    if post.get("url"):
        post["url"] = post["url"].replace("threads.net", "threads.com")
    return post


def _avatar_url(user: dict[str, Any]) -> str | None:
    if not isinstance(user, dict):
        return None
    if user.get("profile_pic_url"):
        return str(user["profile_pic_url"])
    versions = user.get("hd_profile_pic_versions")
    if isinstance(versions, list) and versions:
        last = versions[-1]
        if isinstance(last, dict) and last.get("url"):
            return str(last["url"])
    return None


def _best_image(node: dict[str, Any]) -> str | None:
    versions = node.get("image_versions2") if isinstance(node.get("image_versions2"), dict) else {}
    candidates = versions.get("candidates") or []
    if not candidates:
        return None
    best = max(candidates, key=lambda item: int(item.get("width") or 0))
    url = best.get("url")
    return str(url) if url else None


def _image_urls(post: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    carousel = post.get("carousel_media")
    if isinstance(carousel, list) and carousel:
        for media in carousel:
            if isinstance(media, dict):
                url = _best_image(media)
                if url:
                    urls.append(url)
    else:
        url = _best_image(post)
        if url:
            urls.append(url)
    return list(dict.fromkeys(urls))


def _code_from_url(url: str | None) -> str | None:
    if not url:
        return None
    match = POST_URL_RE.search(url)
    return match.group(2) if match else None


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        digits = re.split(r"\s+", value.strip())[0].replace(",", "")
        if digits.isdigit():
            return int(digits)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def walk_posts(payload: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[int] = set()

    def visit(node: Any) -> None:
        if id(node) in seen:
            return
        if isinstance(node, dict):
            seen.add(id(node))
            raw = node.get("post") if isinstance(node.get("post"), dict) else None
            if raw and raw.get("code") and (raw.get("taken_at") or raw.get("text_post_app_info")):
                found.append(node)
            elif (
                node.get("code")
                and node.get("taken_at")
                and isinstance(node.get("user"), dict)
            ):
                found.append({"post": node})
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            seen.add(id(node))
            for value in node:
                visit(value)

    visit(payload)
    return found


def urls_from_html(html: str) -> list[tuple[str, str]]:
    return list(dict.fromkeys(POST_URL_RE.findall(html)))


def parent_card(post: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": post.get("code") or "",
        "username": post.get("username") or "",
        "text": post.get("text") or "",
        "url": post.get("url") or "",
        "avatar": post.get("avatar") or "",
        "avatar_url": post.get("avatar_url") or "",
        "images": post.get("images") or [],
        "image_urls": post.get("image_urls") or [],
        "published_at": post.get("published_at"),
        "verified": bool(post.get("verified")),
        "like_count": post.get("like_count") or 0,
        "reply_count": post.get("reply_count") or 0,
        "repost_count": post.get("repost_count") or 0,
    }


def walk_thread_groups(payload: Any) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    seen: set[int] = set()

    def visit(node: Any) -> None:
        if id(node) in seen:
            return
        if isinstance(node, dict):
            seen.add(id(node))
            items = node.get("thread_items")
            if isinstance(items, list) and items:
                groups.append(items)
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            seen.add(id(node))
            for value in node:
                visit(value)

    visit(payload)
    return groups


def parse_thread_group(items: list[Any], query: str, source: str) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for item in items:
        post = parse_post(item, query, source)
        if post:
            parsed.append(post)
    if len(parsed) >= 2:
        card = parent_card(parsed[0])
        for child in parsed[1:]:
            child["is_reply"] = True
            child["reply_to"] = child.get("reply_to") or parsed[0].get("username")
            if not (child.get("parent") or {}).get("text"):
                child["parent"] = card
    return parsed


def ingest_payload(payload: Any, query: str, source: str, posts: dict[str, dict[str, Any]]) -> None:
    grouped_codes: set[str] = set()
    for group in walk_thread_groups(payload):
        for post in parse_thread_group(group, query, source):
            _merge_parsed(posts, post)
            if post.get("code"):
                grouped_codes.add(str(post["code"]))
    for raw in walk_posts(payload):
        post = parse_post(raw, query, source)
        if post and str(post.get("code") or "") not in grouped_codes:
            _merge_parsed(posts, post)


def _merge_parsed(posts: dict[str, dict[str, Any]], parsed: dict[str, Any]) -> None:
    key = str(parsed.get("id") or parsed.get("code") or parsed.get("url") or "")
    if not key:
        return
    current = posts.get(key)
    if current is None and parsed.get("code"):
        code = str(parsed["code"])
        for existing_key, existing in posts.items():
            if str(existing.get("code") or "") == code:
                current = existing
                key = existing_key
                break
    if current is None:
        posts[key] = parsed
        return
    if parsed.get("text") and not current.get("text"):
        current["text"] = parsed["text"]
    if parsed.get("image_urls") and not current.get("image_urls"):
        current["image_urls"] = parsed["image_urls"]
    if parsed.get("avatar_url") and not current.get("avatar_url"):
        current["avatar_url"] = parsed["avatar_url"]
        current["verified"] = parsed.get("verified")
    if parsed.get("parent") and not (current.get("parent") or {}).get("text"):
        current["parent"] = parsed["parent"]
        current["is_reply"] = True
    if parsed.get("reply_to") and not current.get("reply_to"):
        current["reply_to"] = parsed["reply_to"]
        current["is_reply"] = True
    posts[key] = current
