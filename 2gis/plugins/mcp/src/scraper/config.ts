import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scraperRoot } from "../repo.js";

export type AppConfig = {
  /** Search phrases typed into 2GIS to find the organisation's branches. */
  queries: string[];
  /** A found branch is kept when its name contains one of these (any case). */
  name_filters: string[];
  /** Branch ids or 2GIS firm URLs that are always tracked. */
  branches: string[];
  /** Branch ids or 2GIS firm URLs that are never tracked. */
  exclude_branches: string[];
  city: string;
  domain: string;
  locale: string;
  timezone: string;
  lookback_hours: number;
  week_hours: number;
  max_reviews_per_branch: number;
  /** Overrides the public key that 2GIS embeds in its own pages. */
  review_api_key: string;
  llm: LlmConfig;
  email: EmailConfig;
};

/** Any OpenAI-compatible chat endpoint; OpenRouter by default. */
export type LlmConfig = {
  enabled: boolean;
  base_url: string;
  /** OpenRouter model slug, e.g. "openai/gpt-4o-mini" or "anthropic/claude-haiku-4.5". */
  model: string;
  /** Name of the environment variable that holds the API key (never the key itself). */
  api_key_env: string;
  batch_size: number;
  temperature: number;
  /** Replaces the built-in description of what the administration cares about. */
  relevance_prompt: string;
};

export type EmailConfig = {
  to: string[];
  from: string;
  /** `{period}` is replaced with the report window, e.g. "7 дней". */
  subject: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  /** Names of the environment variables with the SMTP login and password. */
  smtp_user_env: string;
  smtp_pass_env: string;
  period_hours: number;
};

const DEFAULTS: AppConfig = {
  queries: ["Нархоз", "Narxoz"],
  name_filters: ["нархоз", "narxoz"],
  branches: [],
  exclude_branches: [],
  city: "almaty",
  domain: "2gis.kz",
  locale: "ru_KZ",
  timezone: "Asia/Almaty",
  lookback_hours: 24,
  week_hours: 168,
  max_reviews_per_branch: 500,
  review_api_key: "",
  llm: {
    enabled: true,
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    api_key_env: "OPENROUTER_API_KEY",
    batch_size: 20,
    temperature: 0,
    relevance_prompt: "",
  },
  email: {
    to: [],
    from: "",
    subject: "Нархоз · отзывы 2ГИС за {period}",
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    smtp_user_env: "SMTP_USER",
    smtp_pass_env: "SMTP_PASS",
    period_hours: 168,
  },
};

export function paths(root = scraperRoot()) {
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(data, "runs"), { recursive: true });
  return {
    root,
    data,
    config: join(root, "config.json"),
    reviewsJsonl: join(data, "reviews.jsonl"),
    reviewsCsv: join(data, "reviews.csv"),
    branches: join(data, "branches.json"),
    indexHtml: join(data, "index.html"),
    runs: join(data, "runs"),
  };
}

export function loadConfig(root = scraperRoot()): AppConfig {
  const cfg: AppConfig = { ...DEFAULTS, llm: { ...DEFAULTS.llm }, email: { ...DEFAULTS.email } };
  const file = paths(root).config;
  if (existsSync(file)) {
    const { llm, email, ...rest } = JSON.parse(readFileSync(file, "utf8")) as Partial<AppConfig>;
    Object.assign(cfg, rest);
    // Nested blocks are merged one level deep so a partial block keeps the other defaults.
    Object.assign(cfg.llm, llm ?? {});
    Object.assign(cfg.email, email ?? {});
  } else {
    // First run of a standalone install: leave an editable copy of the defaults.
    writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf8");
  }
  return cfg;
}
