from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

from socnetscraper.config import BROWSER_PROFILE, STORAGE_STATE, threads_credentials
from socnetscraper.media import download_all
from socnetscraper.parse import ingest_payload, parse_post, search_url, urls_from_html, walk_posts

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


class LoginRequired(RuntimeError):
    pass


def save_login_session() -> Path:
    creds = threads_credentials()
    if not creds:
        raise LoginRequired(
            "Set THREADS_USERNAME and THREADS_PASSWORD in .env, then run login again."
        )
    username, password = creds
    BROWSER_PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 900},
            user_agent=USER_AGENT,
            locale="ru-RU",
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.threads.com/login", wait_until="domcontentloaded")
        _login_with_env(page, username, password)
        STORAGE_STATE.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(STORAGE_STATE))
        context.close()
    return STORAGE_STATE


def _login_with_env(page: Any, username: str, password: str) -> None:
    _dismiss_cookies(page)
    for label in (
        "Log in with Instagram",
        "Continue with Instagram",
        "Log in",
        "Войти через Instagram",
        "Войти",
    ):
        button = page.get_by_role("button", name=label)
        try:
            if button.count() and button.first.is_visible():
                button.first.click(timeout=2000)
                page.wait_for_timeout(1200)
                break
        except Exception:
            pass

    user_box = page.locator(
        'input[name="username"], input[aria-label*="username" i], input[aria-label*="email" i], input[autocomplete="username"]'
    )
    pass_box = page.locator('input[name="password"], input[type="password"]')
    user_box.first.wait_for(state="visible", timeout=20000)
    user_box.first.fill(username)
    pass_box.first.fill(password)
    submit = page.locator('button[type="submit"]')
    if submit.count():
        submit.first.click()
    else:
        page.keyboard.press("Enter")

    try:
        page.wait_for_url(
            lambda url: "login" not in url.lower() and "challenge" not in url.lower(),
            timeout=25000,
        )
        return
    except PlaywrightTimeout:
        pass

    print("If Instagram asks for 2FA or a checkpoint, finish it in the browser window.")
    page.wait_for_url(
        lambda url: "login" not in url.lower() and "challenge" not in url.lower(),
        timeout=180000,
    )


def _dismiss_cookies(page: Any) -> None:
    for label in (
        "Allow all cookies",
        "Allow cookies",
        "Accept all",
        "Принять все",
        "Разрешить все",
    ):
        try:
            button = page.get_by_role("button", name=label)
            if button.count() and button.first.is_visible():
                button.first.click(timeout=1500)
        except Exception:
            pass


def search_browser(query: str, cfg: dict[str, Any]) -> list[dict[str, Any]]:
    posts: dict[str, dict[str, Any]] = {}
    filters = cfg.get("search_filters") or ["default", "recent"]
    max_scrolls = int(cfg.get("max_scrolls") or 18)
    cap = int(cfg.get("max_posts_per_query") or 80)
    headless = bool(cfg.get("headless", True))

    with sync_playwright() as playwright:
        context, browser = _open_context(playwright, headless=headless)
        page = context.new_page()
        payloads: list[Any] = []

        def on_response(response: Any) -> None:
            url = response.url
            if "graphql" not in url and "text_post_app" not in url:
                return
            try:
                payloads.append(response.json())
            except Exception:
                return

        page.on("response", on_response)

        for filter_name in filters:
            page.goto(search_url(query, filter_name), wait_until="domcontentloaded")
            try:
                page.wait_for_timeout(3500)
            except PlaywrightTimeout:
                pass
            html = page.content()
            if _login_wall(html, page):
                context.close()
                if browser:
                    browser.close()
                raise LoginRequired(
                    "Threads asked for login. Run: python -m socnetscraper login"
                )
            _scroll(page, max_scrolls)
            html = page.content()
            payloads.extend(_payloads_from_html(html))
            if len(posts) >= cap:
                break

        for payload in payloads:
            ingest_payload(payload, query, "threads_browser", posts)

        _fill_missing_parents(page, posts, query, limit=40, only_replies=False)

        def fetch(url: str, dest: Any) -> bool:
            try:
                response = page.context.request.get(url, timeout=25000)
                if not response.ok:
                    return False
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(response.body())
                return True
            except Exception:
                return False

        download_all(list(posts.values()), fetcher=fetch)
        context.close()
        if browser:
            browser.close()
    return list(posts.values())[:cap]


def _open_context(playwright: Any, headless: bool) -> tuple[Any, Any]:
    launch_kwargs = {
        "headless": headless,
        "viewport": {"width": 1280, "height": 900},
        "user_agent": USER_AGENT,
        "locale": "ru-RU",
    }
    if BROWSER_PROFILE.exists() and any(BROWSER_PROFILE.iterdir()):
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_PROFILE),
            **launch_kwargs,
        )
        return context, None
    browser = playwright.chromium.launch(headless=headless)
    context_kwargs = {
        "viewport": launch_kwargs["viewport"],
        "user_agent": USER_AGENT,
        "locale": "ru-RU",
    }
    if STORAGE_STATE.exists():
        context_kwargs["storage_state"] = str(STORAGE_STATE)
    return browser.new_context(**context_kwargs), browser


def _scroll(page: Any, max_scrolls: int) -> None:
    for _ in range(max_scrolls):
        page.mouse.wheel(0, 2400)
        page.wait_for_timeout(1200)
        for label in ("See more", "View more", "Ещё", "Показать ещё", "More"):
            button = page.get_by_text(label, exact=False)
            try:
                if button.count() and button.first.is_visible():
                    button.first.click(timeout=800)
            except Exception:
                pass


def _login_wall(html: str, page: Any) -> bool:
    blob = html.lower()
    markers = (
        "log in to see",
        "log in or sign up",
        "войдите, чтобы",
        "continue with instagram",
    )
    if any(marker in blob for marker in markers):
        try:
            if page.locator('input[name="username"], input[type="password"]').count():
                return True
        except Exception:
            return True
        return "threads.com/login" in page.url
    return False


def enrich_saved_parents(limit: int = 40) -> int:
    from socnetscraper.config import load_config
    from socnetscraper.store import load_existing, lookback_posts, save_posts
    from socnetscraper.view import write_html

    cfg = load_config()
    existing = load_existing()
    week = lookback_posts(list(existing.values()), int(cfg.get("week_hours") or 168))
    week.sort(key=lambda item: 0 if item.get("username") == "kurenkeyevag" else 1)
    before = sum(1 for item in existing.values() if (item.get("parent") or {}).get("text"))
    keyed = {str(item.get("id") or item.get("code") or item.get("url")): item for item in week}

    with sync_playwright() as playwright:
        context, browser = _open_context(playwright, headless=bool(cfg.get("headless", True)))
        page = context.new_page()
        _fill_missing_parents(page, keyed, "нархоз", limit=limit, only_replies=False)

        def fetch(url: str, dest: Any) -> bool:
            try:
                response = page.context.request.get(url, timeout=25000)
                if not response.ok:
                    return False
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(response.body())
                return True
            except Exception:
                return False

        updated = [item for item in week if (item.get("parent") or {}).get("text")]
        parents = [item["parent"] for item in updated if isinstance(item.get("parent"), dict)]
        download_all(updated + parents, fetcher=fetch)
        context.close()
        if browser:
            browser.close()

    save_posts(list(existing.values()))
    write_html()
    after = sum(1 for item in existing.values() if (item.get("parent") or {}).get("text"))
    return after - before


def _fill_missing_parents(
    page: Any,
    posts: dict[str, dict[str, Any]],
    query: str,
    limit: int = 35,
    only_replies: bool = True,
) -> None:
    from socnetscraper.parse import parent_card, parse_thread_group, walk_thread_groups

    need = [
        post
        for post in posts.values()
        if post.get("url") and not (post.get("parent") or {}).get("text")
    ]
    if only_replies:
        need = [
            post
            for post in need
            if post.get("is_reply") or post.get("reply_to") or post.get("username") == "kurenkeyevag"
        ]
    need.sort(key=lambda item: 0 if item.get("username") == "kurenkeyevag" else 1)

    payloads: list[Any] = []

    def on_response(response: Any) -> None:
        url = response.url
        if "graphql" not in url and "text_post_app" not in url:
            return
        try:
            payloads.append(response.json())
        except Exception:
            return

    page.on("response", on_response)
    by_code = {str(post.get("code")): post for post in posts.values() if post.get("code")}

    for post in need[:limit]:
        payloads.clear()
        target = str(post.get("code") or "")
        try:
            page.goto(post["url"], wait_until="domcontentloaded")
            page.wait_for_timeout(3500)
            payloads.extend(_payloads_from_html(page.content()))
        except Exception:
            continue
        attached = False
        for payload in payloads:
            if attached or not target:
                break
            for group in walk_thread_groups(payload):
                parsed = parse_thread_group(group, query, "threads_browser")
                codes = [str(item.get("code") or "") for item in parsed]
                if target not in codes:
                    continue
                idx = codes.index(target)
                if idx == 0:
                    continue
                parent = parsed[0]
                child = by_code.get(target) or post
                child["is_reply"] = True
                child["reply_to"] = parent.get("username")
                child["parent"] = parent_card(parent)
                attached = True
                break


def _payloads_from_html(html: str) -> list[Any]:
    payloads: list[Any] = []
    marker = '<script type="application/json"'
    start = 0
    while True:
        idx = html.find(marker, start)
        if idx < 0:
            break
        open_tag_end = html.find(">", idx)
        close = html.find("</script>", open_tag_end)
        if open_tag_end < 0 or close < 0:
            break
        raw = html[open_tag_end + 1 : close]
        start = close + 9
        if "thread_items" not in raw and '"caption"' not in raw:
            continue
        try:
            payloads.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return payloads
