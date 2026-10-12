from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from socnetscraper.config import POSTS_CSV, POSTS_JSONL, RUNS_DIR

CSV_FIELDS = [
    "id",
    "code",
    "url",
    "username",
    "text",
    "published_at",
    "like_count",
    "reply_count",
    "repost_count",
    "query",
    "source",
    "scraped_at",
    "relevant",
    "sentiment",
    "topics",
    "summary",
]


def _key(post: dict[str, Any]) -> str:
    return str(post.get("id") or post.get("code") or post.get("url") or "")


def parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def post_datetime(post: dict[str, Any]) -> datetime | None:
    return parse_datetime(post.get("published_at"))


def within_lookback(post: dict[str, Any], hours: int) -> bool:
    dt = post_datetime(post)
    if dt is None:
        return False
    return dt >= datetime.now(timezone.utc) - timedelta(hours=max(1, hours))


def lookback_posts(posts: list[dict[str, Any]], hours: int) -> list[dict[str, Any]]:
    return [post for post in posts if within_lookback(post, hours)]


def load_existing() -> dict[str, dict[str, Any]]:
    posts: dict[str, dict[str, Any]] = {}
    if not POSTS_JSONL.exists():
        return posts
    with POSTS_JSONL.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            key = _key(item)
            if key:
                posts[key] = item
    return posts


def merge_posts(
    existing: dict[str, dict[str, Any]], incoming: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    new_count = 0
    for post in incoming:
        key = _key(post)
        if not key:
            continue
        previous = existing.get(key) or {}
        if key not in existing:
            new_count += 1
        merged = {**previous, **post}
        if not (post.get("text") or "").strip() and previous.get("text"):
            merged["text"] = previous["text"]
        if not (post.get("image_urls") or post.get("images")):
            if previous.get("image_urls"):
                merged["image_urls"] = previous["image_urls"]
            if previous.get("images"):
                merged["images"] = previous["images"]
        if not post.get("avatar") and previous.get("avatar"):
            merged["avatar"] = previous["avatar"]
        if not (post.get("parent") or {}).get("text") and (previous.get("parent") or {}).get("text"):
            merged["parent"] = previous["parent"]
            merged["is_reply"] = True
        existing[key] = merged
    ordered = sorted(
        existing.values(),
        key=lambda item: str(item.get("published_at") or item.get("scraped_at") or ""),
        reverse=True,
    )
    return ordered, new_count


def save_posts(posts: list[dict[str, Any]]) -> None:
    POSTS_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with POSTS_JSONL.open("w", encoding="utf-8") as handle:
        for post in posts:
            handle.write(json.dumps(post, ensure_ascii=False) + "\n")
    with POSTS_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for post in posts:
            analysis = post.get("analysis") if isinstance(post.get("analysis"), dict) else {}
            row = {field: post.get(field, "") for field in CSV_FIELDS}
            row.update(
                relevant=analysis.get("relevant", ""),
                sentiment=analysis.get("sentiment", ""),
                topics="; ".join(analysis.get("topics") or []),
                summary=analysis.get("summary", ""),
            )
            writer.writerow(row)


def save_run(summary: dict[str, Any]) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    path = RUNS_DIR / f"{stamp}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
