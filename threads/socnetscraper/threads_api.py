from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from socnetscraper.parse import parse_post

API_BASE = "https://graph.threads.com/v1.0/keyword_search"
FIELDS = "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply"


def api_token() -> str | None:
    token = os.getenv("THREADS_ACCESS_TOKEN", "").strip()
    return token or None


def search_keyword(query: str, limit: int, hours: int = 168) -> list[dict[str, Any]]:
    token = api_token()
    if not token:
        return []
    since = int((datetime.now(timezone.utc) - timedelta(hours=max(1, hours))).timestamp())
    posts: list[dict[str, Any]] = []
    for search_type in ("RECENT", "TOP"):
        params = {
            "q": query,
            "search_type": search_type,
            "search_mode": "KEYWORD" if not query.startswith("#") else "TAG",
            "fields": FIELDS,
            "limit": min(limit, 100),
            "since": since,
            "access_token": token,
        }
        if query.startswith("#"):
            params["q"] = query.lstrip("#")
        response = requests.get(API_BASE, params=params, timeout=45)
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("data") or []:
            parsed = parse_post(item, query=query, source=f"threads_api:{search_type.lower()}")
            if parsed:
                posts.append(parsed)
        if len(posts) >= limit:
            break
    return posts[:limit]
