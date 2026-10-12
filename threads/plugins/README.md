# Plugins

TypeScript plugins for **Claude Code** and **OpenAI Codex**. Both scrape Threads with
**Node.js + Playwright**. Python is not required.

```
plugins/
  mcp/                 TypeScript MCP + scraper source
  claude/              Claude Code plugin (bundled, self-installing)
  codex/               Codex plugin (bundled, self-installing)
```

## Install (users)

```text
/plugin marketplace add ardakshalkar/SocNetScraper
/plugin install narxoz-threads@narxoz-threads-marketplace
```

That is the whole install. Node 18+ must be on PATH; the plugin does the rest:

- A `SessionStart` hook runs `npm install` in the plugin directory and downloads Chromium.
  It is silent, idempotent (guarded by a `.deps-ok` stamp), and never fails a session.
- If that hook did not run — or the download was interrupted — the MCP server retries the
  same install lazily on the first tool call that needs a browser. Playwright is imported
  dynamically, so the server always starts even with no `node_modules` present.
- Data lands in `~/.narxoz-threads` unless the plugin is running inside this repo, in which
  case it uses the repo's `data/`. `NARXOZ_SCRAPER_ROOT` overrides both.
- `config.json` is written with defaults on first run, ready to edit.

Credentials are the only manual step, and only when Threads shows a login wall. Put
`THREADS_USERNAME` / `THREADS_PASSWORD` (or `THREADS_ACCESS_TOKEN`) in a `.env` next to the
data root, or export them in the shell that launches Claude — `.mcp.json` passes them
through. Run `/narxoz-threads:setup` to see which paths are in play.

## Commands

- `/narxoz-threads:scrape` — collect and summarise the last 7 days
- `/narxoz-threads:report` — summarise the saved archive, no scraping
- `/narxoz-threads:setup` — health check plus browser login

## Build (developers)

Only when the TypeScript in `plugins/mcp/src` changes:

```bash
cd plugins/mcp
npm install
npm run build
```

That writes the bundled `server/index.js` into both `plugins/claude` and `plugins/codex`.
Playwright stays external to the bundle on purpose — it is resolved at runtime from the
installed plugin's own `node_modules`, which is what makes the self-install work.

Keep `skills/scrape-threads-narxoz/SKILL.md` and `scripts/ensure-deps.mjs` identical
between the two plugin directories.
