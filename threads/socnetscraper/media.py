from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from socnetscraper.config import DATA_DIR, MEDIA_DIR

log = logging.getLogger("socnetscraper")
# Previews for the combined report: small enough to embed in one emailed HTML file.
THUMB_SIZE = (360, 360)
THUMB_QUALITY = 70
SAFE = re.compile(r"[^A-Za-z0-9._-]+")
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )
}


def download_all(posts: list[dict[str, Any]], fetcher=None) -> int:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    fetch = fetcher or _fetch
    saved = 0
    for post in posts:
        saved += _download_avatar(post, fetch)
        saved += _download_images(post, fetch)
        parent = post.get("parent")
        if isinstance(parent, dict):
            saved += _download_avatar(parent, fetch)
            saved += _download_images(parent, fetch)
    return saved


def _download_avatar(post: dict[str, Any], fetch) -> int:
    url = post.get("avatar_url")
    username = SAFE.sub("_", post.get("username") or "user")[:80]
    if not url:
        return 0
    dest = MEDIA_DIR / "avatars" / f"{username}{_ext(url, '.jpg')}"
    if dest.exists() or fetch(str(url), dest):
        if dest.exists():
            post["avatar"] = _public(dest)
            return 1
    return 0


def _download_images(post: dict[str, Any], fetch) -> int:
    urls = [str(url) for url in (post.get("image_urls") or []) if url]
    code = SAFE.sub("_", str(post.get("code") or post.get("id") or "post"))[:80]
    folder = MEDIA_DIR / "posts" / code
    local: list[str] = []
    saved = 0
    for index, url in enumerate(urls):
        dest = folder / f"{index}{_ext(url, '.jpg')}"
        if dest.exists() or fetch(url, dest):
            if dest.exists():
                local.append(_public(dest))
                saved += 1
    if local:
        post["images"] = local
        thumbs = [thumb for thumb in (_thumbnail(DATA_DIR / path) for path in local) if thumb]
        if thumbs:
            post["thumbs"] = thumbs
    return saved


def _thumbnail(source: Path) -> str | None:
    """JPEG preview next to the posts folder (media/thumbs/<code>/<n>.jpg); None without Pillow."""
    dest = MEDIA_DIR / "thumbs" / source.parent.name / f"{source.stem}.jpg"
    if not dest.exists():
        try:
            from PIL import Image

            with Image.open(source) as image:
                image.thumbnail(THUMB_SIZE)
                dest.parent.mkdir(parents=True, exist_ok=True)
                image.convert("RGB").save(dest, "JPEG", quality=THUMB_QUALITY, optimize=True)
        except Exception as exc:
            log.debug("Thumbnail failed %s: %s", source.name, exc)
            return None
    return _public(dest)


def _ext(url: str, default: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    return default


def _public(path: Path) -> str:
    return path.relative_to(DATA_DIR).as_posix()


def _fetch(url: str, dest: Path) -> bool:
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(url, headers=HEADERS, timeout=25, stream=True)
        response.raise_for_status()
        data = response.content
        if not data:
            return False
        dest.write_bytes(data)
        return True
    except Exception as exc:
        log.debug("Media download failed %s: %s", dest.name, exc)
        return False
