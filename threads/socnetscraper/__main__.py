from __future__ import annotations

import argparse
import json
import time

import schedule

from socnetscraper.config import load_config
from socnetscraper.run import local_now, scrape_once
from socnetscraper.threads_browser import save_login_session


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape Threads posts about Narxoz / нархоз"
    )
    sub = parser.add_subparsers(dest="command")

    scrape = sub.add_parser("scrape", help="Run one scrape now")
    scrape.add_argument(
        "--browser",
        action="store_true",
        help="Skip the official API and use the browser search",
    )

    analyze = sub.add_parser("analyze", help="Classify saved posts with the LLM (OpenRouter)")
    analyze.add_argument("--force", action="store_true", help="Re-classify posts that already have an analysis")
    analyze.add_argument("--hours", type=int, default=0, help="Only posts from the last N hours (0 = all)")

    sub.add_parser("login", help="Save a Threads browser session for daily runs")

    view = sub.add_parser("view", help="Open the HTML dashboard of scraped posts")
    view.add_argument("--port", type=int, default=8765)
    view.add_argument("--no-open", action="store_true", help="Do not open a browser")
    view.add_argument(
        "--file",
        action="store_true",
        help="Write data/index.html and exit without starting a server",
    )

    daily = sub.add_parser("daily", help="Stay running and scrape once every day")
    daily.add_argument("--time", help="Local HH:MM, default from config.json")
    daily.add_argument(
        "--now",
        action="store_true",
        help="Also scrape immediately before waiting for the next scheduled time",
    )

    args = parser.parse_args()
    command = args.command or "scrape"

    if command == "login":
        path = save_login_session()
        print(f"Saved Threads session to {path}")
        return

    if command == "analyze":
        from socnetscraper.analyze import analyze_posts
        from socnetscraper.view import write_html

        result = analyze_posts(force=args.force, hours=args.hours)
        result["html"] = str(write_html())
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result["errors"] and not result["analyzed"]:
            raise SystemExit(1)
        return

    if command == "view":
        from socnetscraper.view import serve_dashboard, write_html

        if args.file:
            path = write_html()
            print(path)
            return
        serve_dashboard(port=args.port, open_browser=not args.no_open)
        return

    if command == "daily":
        _run_daily(time_override=args.time, run_now=args.now)
        return

    summary = scrape_once(force_browser=getattr(args, "browser", False))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary.get("errors") and summary.get("found") == 0:
        raise SystemExit(1)


def _run_daily(time_override: str | None, run_now: bool) -> None:
    cfg = load_config()
    clock = time_override or str(cfg.get("daily_time") or "09:00")
    tz_name = str(cfg.get("timezone") or "Asia/Almaty")
    print(f"Daily scrape armed for {clock} {tz_name}. Ctrl+C to stop.")

    def job() -> None:
        scrape_once()

    schedule.every().day.at(clock).do(job)
    if run_now:
        job()
    print(f"Machine local time is used by the scheduler. Now: {local_now(tz_name)}")
    while True:
        schedule.run_pending()
        time.sleep(20)


if __name__ == "__main__":
    main()
