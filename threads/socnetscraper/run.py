from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from socnetscraper.analyze import analyze_posts
from socnetscraper.config import LOG_DIR, load_config, search_queries
from socnetscraper.media import download_all
from socnetscraper.parse import is_university_mention
from socnetscraper.store import load_existing, lookback_posts, merge_posts, save_posts, save_run
from socnetscraper.threads_api import api_token, search_keyword
from socnetscraper.threads_browser import LoginRequired, search_browser
from socnetscraper.view import write_html

log = logging.getLogger("socnetscraper")


def local_now(tz_name: str) -> str:
    try:
        return datetime.now(ZoneInfo(tz_name)).isoformat()
    except Exception:
        return datetime.now().isoformat()


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    file_handler = logging.FileHandler(LOG_DIR / "scrape.log", encoding="utf-8")
    handlers.append(file_handler)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )


def scrape_once(force_browser: bool = False) -> dict[str, Any]:
    configure_logging()
    cfg = load_config()
    queries = search_queries(cfg)
    hours = int(cfg.get("lookback_hours") or 24)
    week_hours = int(cfg.get("week_hours") or 168)
    collect_hours = max(hours, week_hours)
    collected: list[dict[str, Any]] = []
    errors: list[str] = []
    source = "threads_browser"

    if api_token() and not force_browser:
        source = "threads_api"
        log.info("Using official Threads keyword search API")
        for query in queries:
            try:
                found = search_keyword(query, int(cfg.get("max_posts_per_query") or 80), hours=collect_hours)
                log.info("API query %r returned %s posts", query, len(found))
                collected.extend(found)
            except Exception as exc:
                message = f"API query {query!r} failed: {exc}"
                log.warning(message)
                errors.append(message)
        if not collected:
            log.info("API returned no posts, falling back to browser search")
            source = "threads_browser"

    if source == "threads_browser" or force_browser:
        source = "threads_browser"
        for query in queries:
            try:
                found = search_browser(query, cfg)
                log.info("Browser query %r returned %s posts", query, len(found))
                collected.extend(found)
            except LoginRequired as exc:
                errors.append(str(exc))
                log.error("%s", exc)
                break
            except Exception as exc:
                message = f"Browser query {query!r} failed: {exc}"
                log.warning(message)
                errors.append(message)

    relevant: list[dict[str, Any]] = []
    seen: set[str] = set()
    for post in collected:
        key = str(post.get("id") or post.get("code") or post.get("url"))
        if not key or key in seen:
            continue
        seen.add(key)
        hits = is_university_mention(post.get("text"), post.get("username"), queries)
        parent = post.get("parent") if isinstance(post.get("parent"), dict) else {}
        if not hits:
            hits = is_university_mention(parent.get("text"), parent.get("username"), queries)
        username = (post.get("username") or "").casefold()
        if not hits and post.get("published_at") and any(name in username for name in ("narxoz", "нархоз")):
            hits = [f"@{post.get('username')}"]
        if not hits:
            continue
        post["matched_keywords"] = hits
        relevant.append(post)

    existing = load_existing()
    merged, new_count = merge_posts(existing, relevant)
    media_saved = download_all(merged)
    save_posts(merged)
    # Only new or edited posts reach the LLM; a failing LLM never fails the scrape.
    try:
        analysis = analyze_posts()
        errors.extend(analysis.pop("errors"))
    except Exception as exc:  # noqa: BLE001
        analysis = None
        errors.append(f"LLM: {exc}")
    merged, _ = merge_posts(load_existing(), [])
    recent = lookback_posts(merged, hours)
    week = lookback_posts(merged, week_hours)
    html_path = write_html(hours)
    summary = {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "timezone": cfg.get("timezone"),
        "local_time": local_now(str(cfg.get("timezone") or "UTC")),
        "source": source,
        "queries": queries,
        "lookback_hours": hours,
        "week_hours": week_hours,
        "found": len(relevant),
        "last_24h": len(recent),
        "last_7d": len(week),
        "new": new_count,
        "total": len(merged),
        "media_files": media_saved,
        "html": str(html_path),
        "analysis": analysis,
        "errors": errors,
    }
    save_run(summary)
    log.info(
        "Saved %s posts (%s new, %s in 24h, %s in 7d, %s media). HTML: %s",
        len(merged),
        new_count,
        len(recent),
        len(week),
        media_saved,
        html_path,
    )
    return summary
