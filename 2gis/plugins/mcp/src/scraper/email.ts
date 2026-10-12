import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { loadConfig } from "./config.js";
import type { Review, Sentiment } from "./parse.js";
import { loadExisting, lookbackReviews, mergeReviews } from "./store.js";
import { writeHtml } from "./view.js";

const COLORS: Record<Sentiment, string> = { negative: "#D50032", neutral: "#8A6D1D", positive: "#1F9D55" };
const TITLES: Record<Sentiment, string> = { negative: "Негативные", neutral: "Нейтральные", positive: "Позитивные" };
const ORDER: Sentiment[] = ["negative", "neutral", "positive"];

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function periodLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "сутки" : `${days} дн.`;
  }
  return `${hours} ч`;
}

function formatWhen(value: string | null, timezone: string): string {
  const ms = Date.parse(String(value || ""));
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: timezone });
}

const TH = 'style="text-align:left;padding:8px 10px;border-bottom:2px solid #e8eaed;color:#667085;font-size:12px"';
const TD = 'style="padding:8px 10px;border-bottom:1px solid #e8eaed;vertical-align:top;font-size:13px"';
const TDN = 'style="padding:8px 10px;border-bottom:1px solid #e8eaed;text-align:right;font-size:13px;white-space:nowrap"';

function summaryTable(reviews: Review[], irrelevant: Review[]): string {
  type Row = { name: string; negative: number; neutral: number; positive: number; irrelevant: number };
  const rows = new Map<string, Row>();
  const row = (review: Review) => {
    let current = rows.get(review.branch_id);
    if (!current) {
      current = { name: `${review.branch_name} — ${review.branch_address}`, negative: 0, neutral: 0, positive: 0, irrelevant: 0 };
      rows.set(review.branch_id, current);
    }
    return current;
  };
  for (const review of reviews) row(review)[review.analysis!.sentiment] += 1;
  for (const review of irrelevant) row(review).irrelevant += 1;
  const sorted = [...rows.values()].sort((a, b) => b.negative - a.negative || a.name.localeCompare(b.name));
  const cell = (n: number, color?: string) =>
    `<td ${TDN}>${color && n ? `<b style="color:${color}">${n}</b>` : n}</td>`;
  return [
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:8px 0 24px">',
    `<tr><th ${TH}>Филиал</th><th ${TH}>Негатив</th><th ${TH}>Нейтрально</th><th ${TH}>Позитив</th><th ${TH}>Нерелевантные</th></tr>`,
    ...sorted.map(
      (r) =>
        `<tr><td ${TD}>${esc(r.name)}</td>${cell(r.negative, COLORS.negative)}${cell(r.neutral, COLORS.neutral)}` +
        `${cell(r.positive, COLORS.positive)}${cell(r.irrelevant)}</tr>`
    ),
    "</table>",
  ].join("");
}

function sentimentSection(sentiment: Sentiment, reviews: Review[], timezone: string): string {
  if (!reviews.length) return "";
  const rows = reviews.map((review) => {
    const gist = review.analysis?.summary || review.text.slice(0, 240);
    const topics = review.analysis?.topics.length ? `<div style="color:#667085;font-size:12px">${esc(review.analysis.topics.join(", "))}</div>` : "";
    const answered = review.replies.some((reply) => reply.from_org) ? "✓" : "—";
    return (
      `<tr><td ${TD}>${esc(formatWhen(review.published_at, timezone))}</td>` +
      `<td ${TD}>${esc(review.branch_name)}</td>` +
      `<td ${TDN}>${review.rating ?? "—"}</td>` +
      `<td ${TD}>${esc(gist)}${topics}</td>` +
      `<td ${TDN}>${answered}</td>` +
      `<td ${TD}><a href="${esc(review.url)}" style="color:#2b6cb0">2ГИС</a></td></tr>`
    );
  });
  return [
    `<h2 style="font-size:17px;margin:24px 0 6px;color:${COLORS[sentiment]}">${TITLES[sentiment]} · ${reviews.length}</h2>`,
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">',
    `<tr><th ${TH}>Дата</th><th ${TH}>Филиал</th><th ${TH}>★</th><th ${TH}>Суть</th><th ${TH}>Ответ</th><th ${TH}></th></tr>`,
    ...rows,
    "</table>",
  ].join("");
}

/** Static, script-free HTML: mail clients strip JavaScript, so the interactive page goes as an attachment. */
export function buildReportHtml(root: string, hours: number): { html: string; counts: Record<string, number> } {
  const cfg = loadConfig(root);
  const [all] = mergeReviews(loadExisting(root), []);
  const recent = lookbackReviews(all, hours);
  const analyzed = recent.filter((review) => review.analysis);
  const relevant = analyzed.filter((review) => review.analysis!.relevant);
  const irrelevant = analyzed.filter((review) => !review.analysis!.relevant);
  const pending = recent.length - analyzed.length;
  const groups = Object.fromEntries(
    ORDER.map((sentiment) => [sentiment, relevant.filter((review) => review.analysis!.sentiment === sentiment)])
  ) as Record<Sentiment, Review[]>;
  const models = [...new Set(analyzed.map((review) => review.analysis!.model))];
  const method = models.length
    ? models.map((model) => (model === "rating-fallback" ? "по звёздам" : model)).join(", ")
    : "—";

  const html = [
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head>',
    '<body style="margin:0;background:#F5F5F6;font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a">',
    '<div style="max-width:880px;margin:0 auto;padding:24px 16px">',
    '<div style="background:#01080A;color:#fff;border-radius:14px;padding:20px 22px">',
    '<div style="color:#D50032;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Narxoz2GisScraper</div>',
    `<div style="font-size:22px;font-weight:650;margin:6px 0">Отзывы 2ГИС за ${esc(periodLabel(hours))}</div>`,
    `<div style="color:#c9cdd3;font-size:13px">Релевантных: ${relevant.length} · негатив ${groups.negative.length} · ` +
      `нейтрально ${groups.neutral.length} · позитив ${groups.positive.length} · отсеяно ${irrelevant.length}` +
      (pending ? ` · без анализа ${pending}` : "") +
      ` · анализ: ${esc(method)}</div>`,
    "</div>",
    '<div style="background:#fff;border:1px solid #e8eaed;border-radius:14px;padding:6px 18px 18px;margin-top:16px">',
    relevant.length || irrelevant.length
      ? `<h2 style="font-size:15px;margin:16px 0 4px;color:#667085">Сводка по филиалам</h2>${summaryTable(relevant, irrelevant)}`
      : '<p style="color:#667085">За этот период новых отзывов нет.</p>',
    ...ORDER.map((sentiment) => sentimentSection(sentiment, groups[sentiment], cfg.timezone || "Asia/Almaty")),
    "</div>",
    '<p style="color:#667085;font-size:12px;margin-top:16px">Полный интерактивный отчёт с фильтрами — во вложении (index.html).</p>',
    "</div></body></html>",
  ].join("\n");
  return {
    html,
    counts: {
      total: recent.length,
      relevant: relevant.length,
      irrelevant: irrelevant.length,
      negative: groups.negative.length,
      neutral: groups.neutral.length,
      positive: groups.positive.length,
      not_analyzed: pending,
    },
  };
}

export async function sendReport(
  root: string,
  options: { to?: string[]; hours?: number } = {}
): Promise<Record<string, unknown>> {
  const { email } = loadConfig(root);
  const to = (options.to?.length ? options.to : email.to).map((address) => address.trim()).filter(Boolean);
  const user = (process.env[email.smtp_user_env] || "").trim();
  const pass = process.env[email.smtp_pass_env] || "";
  const from = email.from.trim() || user;
  const missing = [
    !to.length && "получатели: `email.to` в config.json или параметр `to`",
    !user && `переменная окружения ${email.smtp_user_env} (логин SMTP)`,
    !pass && `переменная окружения ${email.smtp_pass_env} (пароль SMTP / пароль приложения)`,
    !email.smtp_host && "`email.smtp_host` в config.json",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Не настроена отправка почты, не хватает:\n- ${missing.join("\n- ")}`);
  }

  const hours = options.hours && options.hours > 0 ? options.hours : email.period_hours || 168;
  const { html, counts } = buildReportHtml(root, hours);
  const dashboard = writeHtml(root);
  const transport = nodemailer.createTransport({
    host: email.smtp_host,
    port: email.smtp_port,
    secure: email.smtp_secure,
    auth: { user, pass },
  });
  const info = await transport.sendMail({
    from,
    to,
    subject: email.subject.replace("{period}", periodLabel(hours)),
    html,
    attachments: [{ filename: "narxoz-2gis-report.html", content: readFileSync(dashboard), contentType: "text/html" }],
  });
  return { sent_to: to, from, period_hours: hours, message_id: info.messageId, ...counts };
}
