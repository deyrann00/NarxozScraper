# SocNetScraper

Daily collector for public [Threads](https://www.threads.com) posts about **Narxoz / нархоз**. Ship the repo as-is, or plug it into Claude.

Default schedule: **09:00 Asia/Almaty**. Change `daily_time` in `config.json`.

## Setup

```bash
python -m venv .venv
# Windows
.venv\Scripts\pip install -e .
.venv\Scripts\python -m playwright install chromium
```

Put Instagram / Threads credentials in `.env` (gitignored; copy from `.env.example`):

```
THREADS_USERNAME=your_instagram_username
THREADS_PASSWORD=your_password
```

Then:

```bash
python -m socnetscraper login
python -m socnetscraper scrape --browser
```

## Scrape once

```bash
python -m socnetscraper scrape
```

Results:

- `data/index.html` — HTML dashboard (defaults to last 24 hours)
- `data/posts.jsonl` — full archive, deduped by post id
- `data/posts.csv` — spreadsheet-friendly snapshot
- `data/runs/` — one JSON file per run

Open the dashboard:

```bash
python -m socnetscraper view
```

The page loads **last 7 days** first. Switch to **Last 24 hours** for the daily slice.


If Threads asks you to log in, fill `.env` and run `python -m socnetscraper login`.

## LLM analysis (OpenRouter)

Every scrape sends new posts to an LLM through [OpenRouter](https://openrouter.ai). Each post gets an `analysis` block:
- `relevant`: whether it matters to the university administration. Spam, ads and posts where "нархоз" is incidental are marked irrelevant.
- `sentiment`: the author's attitude towards Narxoz: `positive`, `neutral` or `negative`.
- `topics`: up to three topics.
- `summary`: a one-line summary in Russian.

A post is analysed once. It goes to the LLM again only if its text changes. The dashboard gets sentiment tabs, a "show irrelevant" toggle (off by default) and a table view. The CSV gets `relevant`, `sentiment`, `topics` and `summary` columns.

1. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys) and add it to `.env`: `OPENROUTER_API_KEY=sk-or-...`
2. Pick a model in `config.json` → `llm.model`: any OpenRouter slug, such as `openai/gpt-4o-mini`, `google/gemini-2.5-flash` or `anthropic/claude-haiku-4.5`.
3. Re-classify the archive after changing the model or the prompt: `python -m socnetscraper analyze --force`. Add `--hours 168` to limit it to the last week.

| `llm` field | Meaning |
| --- | --- |
| `enabled` | `false` disables the LLM |
| `base_url` | Any OpenAI-compatible endpoint (OpenRouter by default) |
| `model` | Model slug |
| `api_key_env` | Name of the environment variable that holds the key. The key itself never goes in the config |
| `batch_size` | Posts per request (20) |
| `temperature` | Default 0 |
| `relevance_prompt` | Your own description of what the administration cares about. Empty means the built-in one |

Without a key, scraping works as before and posts are simply left unanalysed.

## Docker

The image `deyrann00/socnetscraper` already has Python, Playwright and Chromium installed. See `DOCKERHUB.md`.

```bash
docker run --rm --env-file .env -v "$PWD/data:/app/data" deyrann00/socnetscraper scrape
```

## Run every day

Pick one:

1. **GitHub Actions** — enable the workflow and (optional) add secret `THREADS_ACCESS_TOKEN`. Cron is `0 4 * * *` UTC, which is 09:00 in Almaty.
2. **Windows task** — `powershell -File scripts/install-windows-task.ps1 -Time 09:00`
3. **Keep a process running** — `python -m socnetscraper daily --now`
4. **Linux/macOS cron** — `0 9 * * * cd /path/to/SocNetScraper && .venv/bin/python -m socnetscraper scrape`

## Claude Code plugin (one install, no Python)

Node 18+ on PATH is the only prerequisite. Everything else — Playwright, Chromium, the
data directory, a default `config.json` — the plugin sets up by itself.

```text
/plugin marketplace add ardakshalkar/SocNetScraper
/plugin install narxoz-threads@narxoz-threads-marketplace
```

Then just ask for Narxoz mentions, or use the commands:

| Command | Does |
| --- | --- |
| `/narxoz-threads:scrape` | Collect new posts, summarise the last 7 days |
| `/narxoz-threads:report` | Summarise what is already saved, without scraping |
| `/narxoz-threads:setup` | Check the install, save a Threads login session |

**Where data goes.** A standalone install writes to `~/.narxoz-threads`
(`posts.jsonl`, `posts.csv`, `config.json`, the browser session). Opened inside this repo,
it uses the repo's `data/` instead. Set `NARXOZ_SCRAPER_ROOT` to override either.

**Credentials** are only needed when Threads shows a login wall. Put them in a `.env` next
to the data root — `~/.narxoz-threads/.env` — or export `THREADS_USERNAME` /
`THREADS_PASSWORD` / `THREADS_ACCESS_TOKEN` in your shell before starting Claude. Run
`/narxoz-threads:setup` to see exactly which file is being read.

The first scrape on a new machine takes a few minutes while Chromium downloads.

**Codex plugin**

Install `plugins/codex` (it has `.codex-plugin/plugin.json`). Same self-install behaviour,
same Node 18+ requirement.

**Developing the plugin.** Only needed if you change the TypeScript in `plugins/mcp/src`:

```bash
cd plugins/mcp && npm install && npm run build
```

That rebuilds the bundled `server/index.js` for both plugins. See `plugins/README.md`.

**Claude Desktop MCP (Node, no Python)**

Merge `integrations/claude-desktop.json` into Claude Desktop config (`claude_desktop_config.json`). Point `args` at the built server and `cwd` at this repo:

```json
{
  "mcpServers": {
    "narxoz-threads": {
      "command": "node",
      "args": ["C:/path/to/SocNetScraper/plugins/claude/server/index.js"],
      "cwd": "C:/path/to/SocNetScraper"
    }
  }
}
```

Tools Claude gets:

- `scrape_narxoz_threads`
- `login_narxoz_threads`
- `latest_narxoz_threads`
- `narxoz_threads_status`
- `narxoz_threads_data_path`

## Official API vs browser

If `THREADS_ACCESS_TOKEN` is present, keyword search uses [Meta's Threads Keyword Search API](https://developers.facebook.com/docs/threads/keyword-search/). That is the most stable option to ship. Without a token, the scraper opens Threads search in Chromium and saves public posts.

Needed API permissions: `threads_basic`, `threads_keyword_search`.
