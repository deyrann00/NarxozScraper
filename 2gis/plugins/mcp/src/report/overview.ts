import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { chatJson, llmKey, llmReady } from "../scraper/analyze.js";
import { loadConfig, paths } from "../scraper/config.js";
import type { Sentiment } from "../scraper/parse.js";
import type { Item, Source } from "./sources.js";

const SENTIMENTS: Sentiment[] = ["negative", "neutral", "positive"];
const SOURCES: Source[] = ["2gis", "threads"];
/** Mentions sent to the LLM for the overall summary, newest first. */
const MAX_ITEMS = 250;

type Counts = Record<Sentiment, number>;
const zero = (): Counts => ({ negative: 0, neutral: 0, positive: 0 });

export type Stats = {
  total: number;
  relevant: number;
  irrelevant: number;
  not_analyzed: number;
  sentiment: Counts;
  by_source: Record<Source, Counts & { total: number; relevant: number; irrelevant: number; not_analyzed: number }>;
  avg_rating_2gis: number | null;
  /** Buckets oldest first; `label` is a day (YYYY-MM-DD) or the Monday of a week. */
  timeline: { label: string; unit: "day" | "week"; counts: Counts }[];
  topics: { topic: string; total: number; counts: Counts }[];
};

export type Problem = {
  title: string;
  description: string;
  count: number;
  sources: Source[];
  example_ids: string[];
};

export type Overview = {
  /** Model slug, or null when the LLM was not used. */
  model: string | null;
  summary: string;
  problems: Problem[];
  generated_at: string;
  /** Why there is no LLM summary, if there is none. */
  note: string;
};

function localDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: timezone });
}

function monday(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function computeStats(items: Item[], hours: number, timezone: string): Stats {
  const blank = () => ({ ...zero(), total: 0, relevant: 0, irrelevant: 0, not_analyzed: 0 });
  const stats: Stats = {
    total: items.length,
    relevant: 0,
    irrelevant: 0,
    not_analyzed: 0,
    sentiment: zero(),
    by_source: { "2gis": blank(), threads: blank() },
    avg_rating_2gis: null,
    timeline: [],
    topics: [],
  };
  const unit: "day" | "week" = hours > 45 * 24 ? "week" : "day";
  const buckets = new Map<string, Counts>();
  // Pre-fill every day of a short period so quiet days show as gaps, not as missing bars.
  if (unit === "day" && hours > 0) {
    for (let t = Date.now() - hours * 3600 * 1000; t <= Date.now(); t += 24 * 3600 * 1000) {
      buckets.set(localDate(new Date(t).toISOString(), timezone), zero());
    }
    buckets.set(localDate(new Date().toISOString(), timezone), buckets.get(localDate(new Date().toISOString(), timezone)) ?? zero());
  }
  const topics = new Map<string, Counts>();
  let stars = 0;
  let rated = 0;
  for (const item of items) {
    const source = stats.by_source[item.source];
    source.total += 1;
    if (item.source === "2gis" && item.rating) {
      stars += item.rating;
      rated += 1;
    }
    if (item.relevant === null || !item.sentiment) {
      stats.not_analyzed += 1;
      source.not_analyzed += 1;
      continue;
    }
    if (!item.relevant) {
      stats.irrelevant += 1;
      source.irrelevant += 1;
      continue;
    }
    stats.relevant += 1;
    source.relevant += 1;
    stats.sentiment[item.sentiment] += 1;
    source[item.sentiment] += 1;
    if (item.published_at && !Number.isNaN(Date.parse(item.published_at))) {
      const day = localDate(item.published_at, timezone);
      const key = unit === "week" ? monday(day) : day;
      const bucket = buckets.get(key) ?? zero();
      bucket[item.sentiment] += 1;
      buckets.set(key, bucket);
    }
    for (const raw of item.topics) {
      const topic = raw.trim().toLowerCase();
      if (!topic) continue;
      const counts = topics.get(topic) ?? zero();
      counts[item.sentiment] += 1;
      topics.set(topic, counts);
    }
  }
  stats.avg_rating_2gis = rated ? Math.round((stars / rated) * 10) / 10 : null;
  stats.timeline = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, counts]) => ({ label, unit, counts }));
  stats.topics = [...topics.entries()]
    .map(([topic, counts]) => ({ topic, counts, total: counts.negative + counts.neutral + counts.positive }))
    .sort((a, b) => b.total - a.total || b.counts.negative - a.counts.negative)
    .slice(0, 10);
  return stats;
}

/** Without an LLM: the most frequent topics among negative mentions stand in for "main problems". */
function topicProblems(items: Item[]): Problem[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    if (!item.relevant || item.sentiment !== "negative") continue;
    for (const raw of item.topics) {
      const topic = raw.trim().toLowerCase();
      if (topic) groups.set(topic, [...(groups.get(topic) ?? []), item]);
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([topic, group]) => ({
      title: topic.charAt(0).toUpperCase() + topic.slice(1),
      description: "",
      count: group.length,
      sources: SOURCES.filter((source) => group.some((item) => item.source === source)),
      example_ids: group.slice(0, 3).map((item) => item.id),
    }));
}

const OverviewSchema = z.object({
  summary: z.string(),
  problems: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().default(""),
        count: z.coerce.number().int().min(0).default(0),
        sources: z.array(z.enum(["2gis", "threads"])).default([]),
        example_ids: z.array(z.coerce.string()).default([]),
      })
    )
    .default([]),
});

function periodWords(hours: number): string {
  if (!hours) return "весь архив";
  if (hours % 24 === 0) return hours === 24 ? "последние сутки" : `последние ${hours / 24} дн.`;
  return `последние ${hours} ч`;
}

function systemPrompt(hours: number): string {
  return [
    "Ты аналитик, который готовит для администрации Университета Нархоз (Алматы) обзор того, что о нём пишут.",
    `Источники: отзывы 2ГИС о филиалах (со звёздами) и посты Threads. Период: ${periodWords(hours)}.`,
    "Тебе дают уже отфильтрованные релевантные упоминания с тональностью и темами.",
    "Верни JSON:",
    "summary — 2 коротких абзаца на русском (разделены \\n\\n): общее настроение и баланс тональности, чем отличаются 2ГИС и Threads,",
    "что выделяется за период. Опирайся только на данные, без общих фраз и без выдуманных цифр;",
    "problems — до 6 главных проблем по убыванию важности (частота и серьёзность). Для каждой: title (2–5 слов),",
    "description (одно предложение: в чём суть и где проявляется), count (сколько упоминаний о ней),",
    'sources (["2gis"], ["threads"] или оба), example_ids (1–3 id упоминаний из входных данных, без изменений).',
    "Если негативных упоминаний нет, problems — пустой массив.",
    'Формат: {"summary":"...","problems":[{"title":"...","description":"...","count":3,"sources":["2gis"],"example_ids":["..."]}]}',
  ].join("\n");
}

function userPrompt(items: Item[]): string {
  return JSON.stringify({
    mentions: items.slice(0, MAX_ITEMS).map((item) => ({
      id: item.id,
      source: item.source,
      date: String(item.published_at || "").slice(0, 10),
      stars: item.rating ?? undefined,
      sentiment: item.sentiment,
      topics: item.topics,
      text: (item.summary || item.text).slice(0, 300),
    })),
  });
}

function cacheFile(root: string): string {
  return join(paths(root).data, "report-overview.json");
}

/**
 * Overall LLM summary and main problems for the relevant mentions of the period.
 * Cached by the set of mentions, so rebuilding the page or re-sending it costs nothing.
 */
export async function buildOverview(
  root: string,
  items: Item[],
  hours: number,
  options: { useLlm?: boolean } = {}
): Promise<{ overview: Overview; errors: string[] }> {
  const { llm, report } = loadConfig(root);
  const relevant = items.filter((item) => item.relevant && item.sentiment);
  const fallback = (note: string): Overview => ({
    model: null,
    summary: "",
    problems: topicProblems(relevant),
    generated_at: new Date().toISOString(),
    note,
  });
  if (!relevant.length) return { overview: fallback("За период нет проанализированных релевантных упоминаний."), errors: [] };
  if (options.useLlm === false || !report.overview) return { overview: fallback("Общий анализ LLM отключён."), errors: [] };
  if (!llmReady(llm)) {
    return { overview: fallback(`Общий анализ LLM недоступен: не задана переменная ${llm.api_key_env}.`), errors: [] };
  }

  const key = createHash("sha1")
    .update(JSON.stringify([llm.model, hours, relevant.slice(0, MAX_ITEMS).map((item) => [item.id, item.sentiment, item.summary])]))
    .digest("hex");
  const file = cacheFile(root);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, "utf8"));
      if (cached.key === key) return { overview: cached.overview as Overview, errors: [] };
    } catch {
      // unreadable cache: regenerate
    }
  }

  const known = new Set(relevant.map((item) => item.id));
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const parsed = OverviewSchema.parse(await chatJson(llm, llmKey(llm), systemPrompt(hours), userPrompt(relevant), 180_000));
      const overview: Overview = {
        model: llm.model,
        summary: parsed.summary.trim(),
        problems: parsed.problems.slice(0, 6).map((problem) => ({
          ...problem,
          example_ids: problem.example_ids.filter((id) => known.has(id)).slice(0, 3),
        })),
        generated_at: new Date().toISOString(),
        note: "",
      };
      writeFileSync(file, JSON.stringify({ key, overview }, null, 2), "utf8");
      return { overview, errors: [] };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    overview: fallback("Общий анализ LLM не удался, ниже — частые темы негативных упоминаний."),
    errors: [`LLM overview: ${lastError}`],
  };
}

export { SENTIMENTS, SOURCES, periodWords };
