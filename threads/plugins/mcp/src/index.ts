import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { recentPosts } from "./posts.js";
import { pluginRoot, postsPath, scraperRoot } from "./repo.js";
import { apiToken, envFiles, loadConfig, paths, searchQueries, threadsCredentials } from "./scraper/config.js";
import { saveLoginSession } from "./scraper/browser.js";
import { scrapeOnce } from "./scraper/run.js";

const server = new McpServer({
  name: "narxoz-threads",
  version: "0.3.0",
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (err: unknown) => ({
  content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

server.tool(
  "scrape_narxoz_threads",
  "Scrape public Threads posts about Narxoz / нархоз using the TypeScript engine (no Python).",
  { browser: z.boolean().optional().describe("Skip the official API and use the browser session") },
  async ({ browser }) => {
    try {
      const summary = await scrapeOnce(scraperRoot(), Boolean(browser));
      return text(JSON.stringify(summary, null, 2));
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "login_narxoz_threads",
  "Open a browser and save a Threads/Instagram login session from .env credentials.",
  {},
  async () => {
    try {
      const root = scraperRoot();
      loadConfig(root);
      return text(`Saved session to ${await saveLoginSession(root)}`);
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "narxoz_threads_status",
  "Report where the plugin stores data, which credentials it found, and whether it is ready to scrape.",
  {},
  async () => {
    const root = scraperRoot();
    const cfg = loadConfig(root);
    const loc = paths(root);
    return text(
      JSON.stringify(
        {
          data_root: root,
          plugin_root: pluginRoot(),
          config_file: loc.config,
          posts_file: loc.postsJsonl,
          env_files: envFiles(root).map((file) => ({ path: file, exists: existsSync(file) })),
          playwright_installed: existsSync(`${pluginRoot()}/node_modules/playwright/package.json`),
          has_saved_session:
            existsSync(loc.storageState) || existsSync(loc.browserProfile),
          has_api_token: Boolean(apiToken()),
          has_login_credentials: Boolean(threadsCredentials()),
          queries: searchQueries(cfg),
          posts_collected: existsSync(loc.postsJsonl),
        },
        null,
        2
      )
    );
  }
);

server.tool(
  "latest_narxoz_threads",
  "Return saved Threads posts. hours=168 is last 7 days; hours=0 is the full archive.",
  {
    limit: z.number().int().min(1).max(100).optional(),
    hours: z.number().int().min(0).max(8760).optional(),
  },
  async ({ limit, hours }) => {
    const posts = recentPosts(scraperRoot(), hours ?? 168, limit ?? 25);
    return { content: [{ type: "text" as const, text: JSON.stringify(posts, null, 2) }] };
  }
);

server.tool(
  "narxoz_threads_data_path",
  "Return the path to the JSONL archive of collected Threads posts.",
  {},
  async () => {
    return { content: [{ type: "text" as const, text: postsPath(scraperRoot()) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
