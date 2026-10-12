This repo collects 2GIS reviews of Narxoz University branches (нархоз, narxoz).

When asked for 2GIS reviews, use the TypeScript MCP tools (`scrape_narxoz_2gis`, then `latest_narxoz_2gis`). Do not open a browser and do not build a second scraper. Prefer last 7 days (and last 24 hours if any).

The plugin has no runtime dependencies and needs no login, so never tell the user to run `npm install` to fix a runtime problem — call `narxoz_2gis_status` and report what it says. `npm install && npm run build` in `plugins/mcp` is only for rebuilding the bundled `plugins/claude/server/index.js` after editing `plugins/mcp/src`.
