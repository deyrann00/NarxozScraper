from __future__ import annotations

import json

from mcp.server.mcpserver import MCPServer

from socnetscraper.config import POSTS_JSONL, load_config
from socnetscraper.run import scrape_once
from socnetscraper.store import load_existing, lookback_posts

mcp = MCPServer(
    name="narxoz-threads",
    instructions=(
        "Search public Threads posts about Narxoz University "
        "(keywords: нархоз, narxoz) and return saved results."
    ),
)


@mcp.tool()
def scrape_narxoz_threads(browser: bool = False) -> str:
    """Scrape Threads for posts about нархоз / narxoz and return a JSON summary."""
    summary = scrape_once(force_browser=browser)
    return json.dumps(summary, ensure_ascii=False, indent=2)


@mcp.tool()
def latest_narxoz_threads(limit: int = 25, hours: int = 24) -> str:
    """Return saved Threads posts from the last N hours. Use hours=0 for the full archive."""
    load_config()
    posts = list(load_existing().values())
    posts.sort(
        key=lambda item: str(item.get("published_at") or item.get("scraped_at") or ""),
        reverse=True,
    )
    if hours > 0:
        posts = lookback_posts(posts, hours)
    return json.dumps(posts[: max(1, min(limit, 100))], ensure_ascii=False, indent=2)


@mcp.tool()
def narxoz_threads_data_path() -> str:
    """Return the path to the JSONL file of collected Threads posts."""
    load_config()
    return str(POSTS_JSONL)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
