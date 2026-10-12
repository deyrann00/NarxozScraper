"""LLM analysis of collected posts through OpenRouter (or any OpenAI-compatible endpoint).

Each post gets an ``analysis`` block: whether it is relevant to the university
administration, its sentiment towards Narxoz, topics and a one-line summary.
Results are stored in the archive, so a post is only sent to the LLM once.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

import requests

from socnetscraper.config import load_config
from socnetscraper.store import load_existing, lookback_posts, merge_posts, save_posts

log = logging.getLogger("socnetscraper")

TIMEOUT = 120
CONCURRENCY = 4
MAX_TEXT = 2000
SENTIMENTS = ("positive", "neutral", "negative")

DEFAULT_RELEVANCE = (
    "Релевантный пост — тот, из которого администрация Университета Нархоз может что-то узнать или что-то исправить: "
    "мнения и жалобы об учёбе и преподавателях, деканате и администрации, поступлении и приёмной комиссии, оплате, "
    "стипендиях и грантах, общежитии, столовой, зданиях, Wi-Fi, безопасности, расписании, трудоустройстве, "
    "студенческой жизни и мероприятиях, а также вопросы абитуриентов и студентов о Нархозе и обсуждение его репутации. "
    "Положительный пост с конкретикой тоже релевантен. "
    "Нерелевантный пост: спам и реклама (продажа курсовых, услуг, аккаунтов), боты, бессодержательный текст, "
    "пост, где «нархоз» встречается случайно и речь не об университете (например, адрес или название остановки), "
    "шутки и мемы без сути, личная переписка, не связанная с университетом."
)


def _key(post: dict[str, Any]) -> str:
    return str(post.get("id") or post.get("code") or post.get("url") or "")


def _content(post: dict[str, Any]) -> str:
    parent = post.get("parent") if isinstance(post.get("parent"), dict) else {}
    return (post.get("text") or "") + "\n" + (parent.get("text") or "")


def text_hash(post: dict[str, Any]) -> str:
    return hashlib.sha1(_content(post).encode("utf-8")).hexdigest()


def llm_key(llm: dict[str, Any]) -> str:
    return os.getenv(str(llm.get("api_key_env") or "OPENROUTER_API_KEY"), "").strip()


def llm_ready(llm: dict[str, Any]) -> bool:
    return bool(llm.get("enabled") and llm.get("model") and llm.get("base_url") and llm_key(llm))


def _needs_analysis(post: dict[str, Any], force: bool) -> bool:
    current = post.get("analysis")
    if force or not isinstance(current, dict):
        return True
    return current.get("text_hash") != text_hash(post)


def _system_prompt(llm: dict[str, Any]) -> str:
    return "\n".join(
        [
            "Ты анализируешь посты из Threads, в которых упоминается Университет Нархоз (Алматы), для администрации университета.",
            str(llm.get("relevance_prompt") or "").strip() or DEFAULT_RELEVANCE,
            "Для каждого поста определи:",
            "relevant — true/false по правилам выше;",
            'sentiment — отношение автора к Нархозу: "positive", "neutral" или "negative" '
            '(смешанный пост без явного перевеса или просто вопрос — "neutral");',
            "topics — 1–3 коротких темы на русском в нижнем регистре (например «общежитие», «поступление», «преподаватели»), "
            "пустой массив для нерелевантных;",
            "summary — суть поста одной фразой на русском, до 160 символов.",
            "Если пост — ответ, поле parent содержит пост, на который отвечают: учитывай его как контекст.",
            'Ответь только JSON вида {"items":[{"id":"...","relevant":true,"sentiment":"negative","topics":["..."],"summary":"..."}]} '
            "— по одному элементу на каждый пост, id без изменений.",
        ]
    )


def _user_prompt(batch: list[dict[str, Any]]) -> str:
    items = []
    for post in batch:
        parent = post.get("parent") if isinstance(post.get("parent"), dict) else {}
        item: dict[str, Any] = {
            "id": _key(post),
            "author": post.get("username") or "",
            "text": (post.get("text") or "")[:MAX_TEXT],
        }
        if parent.get("text"):
            item["parent"] = {"author": parent.get("username") or "", "text": parent["text"][:800]}
        items.append(item)
    return json.dumps({"posts": items}, ensure_ascii=False)


def _extract_json(content: str) -> Any:
    """Models sometimes wrap JSON in a ```json fence despite response_format."""
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
    raw = (fenced.group(1) if fenced else content).strip()
    start, end = raw.find("{"), raw.rfind("}")
    return json.loads(raw[start : end + 1] if 0 <= start < end else raw)


def _validate(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        raise ValueError("response has no items array")
    valid = []
    for item in items:
        if not isinstance(item, dict) or "id" not in item:
            continue
        sentiment = str(item.get("sentiment") or "").lower()
        if sentiment not in SENTIMENTS or not isinstance(item.get("relevant"), bool):
            continue
        topics = item.get("topics") if isinstance(item.get("topics"), list) else []
        valid.append(
            {
                "id": str(item["id"]),
                "relevant": item["relevant"],
                "sentiment": sentiment,
                "topics": [str(topic) for topic in topics][:5],
                "summary": str(item.get("summary") or "")[:300],
            }
        )
    if items and not valid:
        raise ValueError("no valid items in response")
    return valid


def _classify_batch(llm: dict[str, Any], key: str, batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    response = requests.post(
        str(llm["base_url"]).rstrip("/") + "/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # OpenRouter attribution headers; other OpenAI-compatible endpoints ignore them.
            "HTTP-Referer": "https://github.com/deyrann00/SocNetScraper",
            "X-Title": "SocNetScraper",
        },
        json={
            "model": llm["model"],
            "temperature": llm.get("temperature", 0),
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": _system_prompt(llm)},
                {"role": "user", "content": _user_prompt(batch)},
            ],
        },
        timeout=TIMEOUT,
    )
    if not response.ok:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
    content = ((response.json().get("choices") or [{}])[0].get("message") or {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(f"empty completion: {response.text[:300]}")
    return _validate(_extract_json(content).get("items"))


def analyze_posts(force: bool = False, hours: int = 0) -> dict[str, Any]:
    """Classify posts with no analysis yet (or edited since), in place in the archive."""
    llm = load_config()["llm"]
    posts, _ = merge_posts(load_existing(), [])
    scope = lookback_posts(posts, hours) if hours and hours > 0 else posts
    pending = [post for post in scope if _key(post) and _needs_analysis(post, force)]
    errors: list[str] = []
    analyzed = 0

    if not llm_ready(llm):
        if pending:
            reason = "llm.enabled = false" if not llm.get("enabled") else f"переменная {llm.get('api_key_env')} не задана"
            errors.append(f"LLM: {reason} — {len(pending)} постов без анализа")
    else:
        key = llm_key(llm)
        size = max(1, min(int(llm.get("batch_size") or 20), 50))
        batches = [pending[i : i + size] for i in range(0, len(pending), size)]

        def run(batch: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None, str]:
            last_error = ""
            for _ in range(2):
                try:
                    return batch, _classify_batch(llm, key, batch), ""
                except Exception as exc:  # noqa: BLE001 - reported per batch, the run continues
                    last_error = str(exc)
            return batch, None, f"LLM batch {_key(batch[0])}…{_key(batch[-1])}: {last_error}"

        with ThreadPoolExecutor(max_workers=min(CONCURRENCY, len(batches) or 1)) as pool:
            for batch, items, error in pool.map(run, batches):
                if error:
                    errors.append(error)
                    continue
                by_id = {item["id"]: item for item in items or []}
                now = datetime.now(timezone.utc).isoformat()
                for post in batch:
                    item = by_id.get(_key(post))
                    if not item:
                        continue  # left pending; the next run picks it up
                    post["analysis"] = {
                        "relevant": item["relevant"],
                        "sentiment": item["sentiment"],
                        "topics": item["topics"],
                        "summary": item["summary"],
                        "model": llm["model"],
                        "text_hash": text_hash(post),
                        "analyzed_at": now,
                    }
                    analyzed += 1

    if analyzed:
        save_posts(posts)
    by_sentiment = dict.fromkeys(SENTIMENTS, 0)
    relevant = irrelevant = 0
    for post in scope:
        analysis = post.get("analysis")
        if not isinstance(analysis, dict):
            continue
        if analysis.get("relevant"):
            relevant += 1
            by_sentiment[analysis.get("sentiment", "neutral")] += 1
        else:
            irrelevant += 1
    for error in errors:
        log.warning("%s", error)
    return {
        "model": llm.get("model") if llm_ready(llm) else None,
        "analyzed": analyzed,
        "not_analyzed": sum(1 for post in scope if not isinstance(post.get("analysis"), dict)),
        "total": len(scope),
        "relevant": relevant,
        "irrelevant": irrelevant,
        "by_sentiment": by_sentiment,
        "errors": errors,
    }
