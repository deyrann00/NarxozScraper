import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeRoot, scraperRoot } from "../repo.js";

export type AppConfig = {
  keywords: string[];
  hashtags: string[];
  timezone: string;
  daily_time: string;
  lookback_hours: number;
  week_hours: number;
  max_scrolls: number;
  max_posts_per_query: number;
  headless: boolean;
  search_filters: string[];
};

const DEFAULTS: AppConfig = {
  keywords: ["нархоз", "narxoz"],
  hashtags: ["narxoz", "нархоз"],
  timezone: "Asia/Almaty",
  daily_time: "09:00",
  lookback_hours: 24,
  week_hours: 168,
  max_scrolls: 10,
  max_posts_per_query: 80,
  headless: true,
  search_filters: ["recent", "default"],
};

/** `.env` files read in order; the first non-empty value for a key wins. */
export function envFiles(root: string): string[] {
  const files = [join(root, ".env")];
  const home = join(homeRoot(), ".env");
  if (!files.includes(home)) {
    files.push(home);
  }
  return files;
}

export function loadDotEnv(root: string): void {
  for (const file of envFiles(root)) {
    readDotEnvFile(file);
  }
}

function readDotEnvFile(file: string): void {
  if (!existsSync(file)) {
    return;
  }
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx < 1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // An empty value counts as unset: the plugin passes through blank
    // placeholders like ${THREADS_USERNAME:-} when the shell has no such var.
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

export function paths(root = scraperRoot()) {
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  mkdirSync(join(data, "runs"), { recursive: true });
  return {
    root,
    data,
    config: join(root, "config.json"),
    postsJsonl: join(data, "posts.jsonl"),
    postsCsv: join(data, "posts.csv"),
    storageState: join(data, "storage_state.json"),
    browserProfile: join(data, "browser_profile"),
    runs: join(data, "runs"),
  };
}

export function loadConfig(root = scraperRoot()): AppConfig {
  loadDotEnv(root);
  const cfg = { ...DEFAULTS };
  const file = paths(root).config;
  if (existsSync(file)) {
    Object.assign(cfg, JSON.parse(readFileSync(file, "utf8")) as Partial<AppConfig>);
  } else {
    // First run of a standalone install: leave an editable copy of the defaults.
    writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf8");
  }
  return cfg;
}

export function searchQueries(cfg: AppConfig): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...cfg.keywords, ...cfg.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`)]) {
    const query = String(raw).trim();
    const key = query.toLowerCase();
    if (query && !seen.has(key)) {
      seen.add(key);
      queries.push(query);
    }
  }
  return queries;
}

export function apiToken(): string | undefined {
  return process.env.THREADS_ACCESS_TOKEN?.trim() || undefined;
}

export function threadsCredentials(): { username: string; password: string } | undefined {
  const username = process.env.THREADS_USERNAME?.trim() || "";
  const password = process.env.THREADS_PASSWORD?.trim() || "";
  if (username && password) {
    return { username, password };
  }
  return undefined;
}
