import { createHash } from "node:crypto";
import { z } from "zod";
import { type LlmConfig, loadConfig } from "./config.js";
import type { Analysis, Review, Sentiment } from "./parse.js";
import { loadExisting, lookbackReviews, mergeReviews, saveReviews } from "./store.js";

export const FALLBACK_MODEL = "rating-fallback";
const TIMEOUT_MS = 120_000;
/** Batches sent to the LLM at the same time. */
const CONCURRENCY = 4;
/** Long reviews are cut so one essay cannot blow up a batch. */
const MAX_TEXT = 2000;

const DEFAULT_RELEVANCE = [
  "Релевантный отзыв — тот, из которого администрация университета может что-то узнать или что-то исправить:",
  "учёба и качество преподавания, преподаватели и кураторы, деканат и администрация, приёмная комиссия и поступление,",
  "оплата, стипендии и гранты, общежитие, столовая, здания и инфраструктура, Wi-Fi, библиотека, безопасность,",
  "охрана и пропускной режим, отношение персонала, расписание, трудоустройство, студенческая жизнь.",
  "Положительный отзыв с конкретикой (что именно понравилось) тоже релевантен.",
  "Нерелевантный отзыв: спам и реклама, бессодержательный текст («норм», «ок», одни смайлы), пустой отзыв с одной оценкой,",
  "отзыв явно не о Нархозе (о другой организации или ошибочно оставленный не в той карточке), оскорбления без сути,",
  "отзыв о парковке или магазине поблизости, не связанных с университетом.",
].join(" ");

const ItemSchema = z.object({
  id: z.coerce.string(),
  relevant: z.boolean(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  topics: z.array(z.string()).default([]),
  summary: z.string().default(""),
});
const ResponseSchema = z.object({ items: z.array(ItemSchema) });

export type AnalyzeResult = {
  model: string;
  analyzed: number;
  skipped_cached: number;
  total: number;
  relevant: number;
  irrelevant: number;
  by_sentiment: Record<Sentiment, number>;
  errors: string[];
};

export function textHash(review: Review): string {
  return createHash("sha1").update(review.text || "").digest("hex");
}

export function llmKey(llm: LlmConfig): string {
  return (process.env[llm.api_key_env || "OPENROUTER_API_KEY"] || "").trim();
}

/** True when an LLM call will be made rather than the star-rating fallback. */
export function llmReady(llm: LlmConfig): boolean {
  return Boolean(llm.enabled && llm.model && llm.base_url && llmKey(llm));
}

function ratingSentiment(rating: number | null): Sentiment {
  if (!rating) return "neutral";
  return rating >= 4 ? "positive" : rating <= 2 ? "negative" : "neutral";
}

function fallback(review: Review): Analysis {
  return {
    relevant: true,
    sentiment: ratingSentiment(review.rating),
    topics: [],
    summary: "",
    model: FALLBACK_MODEL,
    text_hash: textHash(review),
    analyzed_at: new Date().toISOString(),
  };
}

function needsAnalysis(review: Review, useLlm: boolean, force: boolean): boolean {
  const current = review.analysis;
  if (force || !current) return true;
  if (current.text_hash !== textHash(review)) return true;
  // A star-rating guess is upgraded as soon as an LLM is configured.
  return useLlm && current.model === FALLBACK_MODEL;
}

function systemPrompt(llm: LlmConfig): string {
  return [
    "Ты анализируешь отзывы из 2ГИС об Университете Нархоз (Алматы) для администрации университета.",
    llm.relevance_prompt.trim() || DEFAULT_RELEVANCE,
    "Для каждого отзыва определи:",
    "relevant — true/false по правилам выше;",
    'sentiment — "positive", "neutral" или "negative" по смыслу текста (звёзды — подсказка, но текст важнее; смешанный отзыв без явного перевеса — "neutral");',
    "topics — 1–3 коротких темы на русском в нижнем регистре (например «общежитие», «преподаватели», «оплата»), пустой массив для нерелевантных;",
    "summary — суть отзыва одной фразой на русском, до 160 символов.",
    'Ответь только JSON вида {"items":[{"id":"...","relevant":true,"sentiment":"negative","topics":["..."],"summary":"..."}]} — по одному элементу на каждый отзыв, id без изменений.',
  ].join("\n");
}

function userPrompt(batch: Review[]): string {
  const items = batch.map((review) => ({
    id: review.id,
    branch: review.branch_name,
    stars: review.rating,
    text: (review.text || "").slice(0, MAX_TEXT),
    org_reply: review.replies.find((reply) => reply.from_org)?.text.slice(0, 500) || undefined,
  }));
  return JSON.stringify({ reviews: items });
}

/** Models sometimes wrap JSON in a ```json fence despite response_format. */
function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
}

async function classifyBatch(llm: LlmConfig, key: string, batch: Review[]): Promise<z.infer<typeof ItemSchema>[]> {
  const response = await fetch(`${llm.base_url.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // OpenRouter attribution headers; other OpenAI-compatible endpoints ignore them.
      "HTTP-Referer": "https://github.com/deyrann00/Narxoz2GisScraper",
      "X-Title": "Narxoz2GisScraper",
    },
    body: JSON.stringify({
      model: llm.model,
      temperature: llm.temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(llm) },
        { role: "user", content: userPrompt(batch) },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const content = JSON.parse(body)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`empty completion: ${body.slice(0, 300)}`);
  }
  return ResponseSchema.parse(extractJson(content)).items;
}

/**
 * Classifies reviews that have no analysis yet (or were edited since), in place in the archive.
 * Without an API key every pending review gets a star-rating guess, so the dashboard still works.
 */
export async function analyzeReviews(
  root: string,
  options: { force?: boolean; hours?: number } = {}
): Promise<AnalyzeResult> {
  const { llm } = loadConfig(root);
  const useLlm = llmReady(llm);
  const key = llmKey(llm);
  const errors: string[] = [];
  const [reviews] = mergeReviews(loadExisting(root), []);
  const scope = options.hours && options.hours > 0 ? lookbackReviews(reviews, options.hours) : reviews;
  const pending = scope.filter((review) => needsAnalysis(review, useLlm, Boolean(options.force)));
  let analyzed = 0;

  if (!useLlm) {
    for (const review of pending) {
      review.analysis = fallback(review);
      analyzed += 1;
    }
    if (llm.enabled && !key && pending.length) {
      errors.push(`LLM: переменная ${llm.api_key_env} не задана — тональность определена по звёздам`);
    }
  } else {
    const size = Math.max(1, Math.min(llm.batch_size || 20, 50));
    const batches: Review[][] = [];
    for (let i = 0; i < pending.length; i += size) {
      batches.push(pending.slice(i, i + size));
    }
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        let items: z.infer<typeof ItemSchema>[] | null = null;
        for (let attempt = 1; attempt <= 2 && !items; attempt += 1) {
          try {
            items = await classifyBatch(llm, key, batch);
          } catch (err) {
            if (attempt === 2) {
              const ids = `${batch[0].id}…${batch[batch.length - 1].id}`;
              errors.push(`LLM batch ${ids}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
        if (!items) continue;
        const byId = new Map(items.map((item) => [item.id, item]));
        const now = new Date().toISOString();
        for (const review of batch) {
          const item = byId.get(review.id);
          if (!item) continue; // left pending; the next run picks it up
          review.analysis = {
            relevant: item.relevant,
            sentiment: item.sentiment,
            topics: item.topics.slice(0, 5),
            summary: item.summary.slice(0, 300),
            model: llm.model,
            text_hash: textHash(review),
            analyzed_at: now,
          };
          analyzed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  }

  if (analyzed) {
    saveReviews(root, reviews);
  }
  const by_sentiment: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  let relevant = 0;
  let irrelevant = 0;
  for (const review of scope) {
    if (!review.analysis) continue;
    if (review.analysis.relevant) {
      relevant += 1;
      by_sentiment[review.analysis.sentiment] += 1;
    } else {
      irrelevant += 1;
    }
  }
  return {
    model: useLlm ? llm.model : FALLBACK_MODEL,
    analyzed,
    skipped_cached: scope.length - pending.length,
    total: scope.length,
    relevant,
    irrelevant,
    by_sentiment,
    errors,
  };
}
