---
name: scrape-threads-narxoz
description: Scrapes public Threads posts about Narxoz University with the TypeScript plugin (no Python). Use when the user asks for Threads mentions of нархоз or narxoz, a daily Narxoz social listening run, or to summarize collected Threads posts.
---

# Scrape Threads for Narxoz

Use this plugin's MCP tools. Do **not** call Python and do **not** write a second scraper.

## Tools

- `scrape_narxoz_threads` — collect posts (`browser: true` skips the official API)
- `latest_narxoz_threads` — read saved posts (`hours: 168` for a week, `24` for a day, `0` for everything)
- `login_narxoz_threads` — open a browser and save a Threads session
- `narxoz_threads_status` — data root, credentials found, install health
- `narxoz_threads_data_path` — path to `posts.jsonl`

## Setup

Nothing to install. The plugin installs Node Playwright and Chromium by itself on first
use; the first scrape on a new machine takes a few minutes because of that download.

Credentials are the only manual step, and only if Threads shows a login wall. They live in
a `.env` file next to the data root reported by `narxoz_threads_status`
(`~/.narxoz-threads/.env` for a standalone install):

```
THREADS_USERNAME=...
THREADS_PASSWORD=...
```

or `THREADS_ACCESS_TOKEN=...` to use the official API instead. Never ask the user to type
credentials into the chat — have them edit the file.

To keep data somewhere else, set `NARXOZ_SCRAPER_ROOT` before starting Claude.

## Workflow

1. `scrape_narxoz_threads`
2. On a login error, `login_narxoz_threads`, then retry once
3. `latest_narxoz_threads` with `hours: 168`, and again with `hours: 24` if there is a week's worth

## Reporting

Prefer the last 7 days, and call out the last 24 hours separately when there is anything.
Give author, date, link, and a one-line gist per post. Show replies with the parent question
they answer. Ignore anesthesia false positives (наркоз matched as нархоз).
