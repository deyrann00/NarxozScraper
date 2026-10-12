This repo collects public Threads posts about Narxoz University (нархоз, narxoz).

When asked for Threads mentions, use the TypeScript MCP tools (`scrape_narxoz_threads`, then `latest_narxoz_threads`). Do not run Python and do not build a second scraper. Prefer last 7 days (and last 24 hours if any). If login is required, call `login_narxoz_threads`.

The plugin installs Playwright and Chromium on its own, so never tell the user to run `npm install` to fix a runtime problem — call `narxoz_threads_status` and report what it says. `npm install && npm run build` in `plugins/mcp` is only for rebuilding the bundled server after editing `plugins/mcp/src`.

Python CLI (`python -m socnetscraper`) is only for cron / Windows Task Scheduler, not for Claude.
