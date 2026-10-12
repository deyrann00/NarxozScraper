from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# NARXOZ_SCRAPER_ROOT moves data/, logs/, config.json and .env elsewhere (same variable as the plugin).
ROOT = Path(os.getenv("NARXOZ_SCRAPER_ROOT") or Path(__file__).resolve().parent.parent).resolve()
DATA_DIR = ROOT / "data"
LOG_DIR = ROOT / "logs"
CONFIG_PATH = ROOT / "config.json"
STORAGE_STATE = DATA_DIR / "storage_state.json"
BROWSER_PROFILE = DATA_DIR / "browser_profile"
POSTS_JSONL = DATA_DIR / "posts.jsonl"
POSTS_CSV = DATA_DIR / "posts.csv"
INDEX_HTML = DATA_DIR / "index.html"
MEDIA_DIR = DATA_DIR / "media"
RUNS_DIR = DATA_DIR / "runs"

DEFAULTS: dict[str, Any] = {
    "keywords": ["нархоз", "narxoz"],
    "hashtags": ["narxoz", "нархоз"],
    "timezone": "Asia/Almaty",
    "daily_time": "09:00",
    "lookback_hours": 24,
    "week_hours": 168,
    "max_scrolls": 10,
    "max_posts_per_query": 80,
    "headless": True,
    "search_filters": ["recent", "default"],
    # LLM analysis through OpenRouter or any OpenAI-compatible endpoint.
    "llm": {
        "enabled": True,
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openai/gpt-4o-mini",
        "api_key_env": "OPENROUTER_API_KEY",
        "batch_size": 20,
        "temperature": 0,
        "relevance_prompt": "",
    },
}


def load_env() -> None:
    load_dotenv(ROOT / ".env")


def threads_credentials() -> tuple[str, str] | None:
    load_env()
    username = os.getenv("THREADS_USERNAME", "").strip()
    password = os.getenv("THREADS_PASSWORD", "").strip()
    if username and password:
        return username, password
    return None


def load_config() -> dict[str, Any]:
    load_env()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    cfg = dict(DEFAULTS)
    cfg["llm"] = dict(DEFAULTS["llm"])
    if CONFIG_PATH.exists():
        user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        # The llm block is merged one level deep so a partial block keeps the other defaults.
        llm = user.pop("llm", None) or {}
        cfg.update(user)
        cfg["llm"].update(llm)
    return cfg


def search_queries(cfg: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    seen: set[str] = set()
    for raw in list(cfg.get("keywords") or []) + [
        f"#{tag.lstrip('#')}" for tag in (cfg.get("hashtags") or [])
    ]:
        query = str(raw).strip()
        key = query.casefold()
        if query and key not in seen:
            seen.add(key)
            queries.append(query)
    return queries
