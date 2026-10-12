import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./cli.js";
import { pluginRoot, reviewsPath, scraperRoot } from "./repo.js";
import { recentReviews } from "./reviews.js";
import { discoverBranches } from "./scraper/branches.js";
import { analyzeReviews, llmKey, llmReady } from "./scraper/analyze.js";
import { loadConfig, paths } from "./scraper/config.js";
import { sendReport } from "./scraper/email.js";
import { scrapeOnce } from "./scraper/run.js";
import { loadBranches, saveBranches } from "./scraper/store.js";
import { openInBrowser, writeHtml } from "./scraper/view.js";

const server = new McpServer({
  name: "narxoz-2gis",
  version: "0.4.1",
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));
const failure = (err: unknown) => ({
  content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

function lastRun(runsDir: string): unknown {
  const latest = readdirSync(runsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .pop();
  if (!latest) {
    return null;
  }
  try {
    const run = JSON.parse(readFileSync(join(runsDir, latest), "utf8"));
    return { ran_at: run.ran_at, found: run.found, new: run.new, total: run.total, errors: run.errors };
  } catch {
    return null;
  }
}

server.tool(
  "scrape_narxoz_2gis",
  "Collect 2GIS reviews for every Narxoz branch (plain HTTP, no browser, no login).",
  {
    full: z
      .boolean()
      .optional()
      .describe("Backfill the archive: ignore the weekly window and read up to max_reviews_per_branch"),
  },
  async ({ full }) => {
    try {
      return json(await scrapeOnce(scraperRoot(), Boolean(full)));
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "find_narxoz_2gis_branches",
  "Search 2GIS and list the branches that will be scraped, with their rating and review count.",
  {},
  async () => {
    try {
      const root = scraperRoot();
      const discovery = await discoverBranches(loadConfig(root));
      if (discovery.branches.length) {
        saveBranches(root, discovery.branches);
      }
      return json({ branches: discovery.branches, errors: discovery.errors });
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "narxoz_2gis_status",
  "Report where the plugin stores data, which branches it tracks, and when it last ran.",
  {},
  async () => {
    try {
      const root = scraperRoot();
      const cfg = loadConfig(root);
      const loc = paths(root);
      return json({
        data_root: root,
        plugin_root: pluginRoot(),
        config_file: loc.config,
        reviews_file: loc.reviewsJsonl,
        branches_file: loc.branches,
        dashboard_file: loc.indexHtml,
        queries: cfg.queries,
        name_filters: cfg.name_filters,
        city: cfg.city,
        domain: cfg.domain,
        tracked_branches: loadBranches(root).map(({ id, name, address, rating, reviews_count }) => ({
          id,
          name,
          address,
          rating,
          reviews_count,
        })),
        reviews_collected: existsSync(loc.reviewsJsonl),
        llm: {
          enabled: cfg.llm.enabled,
          base_url: cfg.llm.base_url,
          model: cfg.llm.model,
          api_key_env: cfg.llm.api_key_env,
          api_key_set: Boolean(llmKey(cfg.llm)),
          active: llmReady(cfg.llm),
        },
        email: {
          to: cfg.email.to,
          smtp_host: cfg.email.smtp_host,
          smtp_port: cfg.email.smtp_port,
          smtp_user_set: Boolean(process.env[cfg.email.smtp_user_env]),
          smtp_pass_set: Boolean(process.env[cfg.email.smtp_pass_env]),
          period_hours: cfg.email.period_hours,
        },
        last_run: lastRun(loc.runs),
      });
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "latest_narxoz_2gis",
  "Return saved 2GIS reviews, newest first. hours=168 is last 7 days; hours=0 is the full archive.",
  {
    limit: z.number().int().min(1).max(200).optional(),
    hours: z.number().int().min(0).max(87600).optional(),
    max_rating: z.number().int().min(1).max(5).optional().describe("Only reviews with this many stars or fewer"),
    sentiment: z.enum(["positive", "neutral", "negative"]).optional().describe("Only reviews with this sentiment"),
    include_irrelevant: z
      .boolean()
      .optional()
      .describe("Also return reviews the LLM marked irrelevant (spam, empty, not about Narxoz); default false"),
  },
  async ({ limit, hours, max_rating, sentiment, include_irrelevant }) => {
    try {
      return json(
        recentReviews(scraperRoot(), hours ?? 168, limit ?? 50, max_rating, sentiment, Boolean(include_irrelevant))
      );
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "analyze_narxoz_2gis",
  "Classify saved reviews with the configured LLM (OpenRouter): relevant to the administration or not, and positive / neutral / negative. Already analysed reviews are skipped unless force is set. Rebuilds data/index.html.",
  {
    force: z.boolean().optional().describe("Re-classify reviews that already have an analysis"),
    hours: z.number().int().min(0).max(87600).optional().describe("Only reviews from the last N hours; 0 or omitted = whole archive"),
  },
  async ({ force, hours }) => {
    try {
      const root = scraperRoot();
      const result = await analyzeReviews(root, { force: Boolean(force), hours: hours ?? 0 });
      return json({ ...result, dashboard: writeHtml(root) });
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "send_narxoz_2gis_report",
  "Email the report (relevant reviews split into negative / neutral / positive, plus the HTML dashboard as an attachment) over SMTP. Only call when the user asks to send it.",
  {
    to: z.array(z.string().email()).optional().describe("Recipients; defaults to email.to in config.json"),
    hours: z.number().int().min(1).max(87600).optional().describe("Report window in hours; defaults to email.period_hours (168)"),
  },
  async ({ to, hours }) => {
    try {
      return json(await sendReport(scraperRoot(), { to, hours }));
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "view_narxoz_2gis",
  "Rebuild the HTML dashboard of saved 2GIS reviews (data/index.html) and open it in the browser.",
  {
    open: z.boolean().optional().describe("Open the page in the default browser (default true)"),
  },
  async ({ open }) => {
    try {
      const file = writeHtml(scraperRoot());
      if (open !== false) {
        openInBrowser(file);
      }
      return text(file);
    } catch (err) {
      return failure(err);
    }
  }
);

server.tool(
  "narxoz_2gis_data_path",
  "Return the path to the JSONL archive of collected 2GIS reviews.",
  {},
  async () => text(reviewsPath(scraperRoot()))
);

// With arguments this is a one-shot command (cron, Docker); without, an MCP server on stdio.
if (process.argv.length > 2) {
  process.exitCode = await runCli(process.argv.slice(2));
} else {
  await server.connect(new StdioServerTransport());
}
