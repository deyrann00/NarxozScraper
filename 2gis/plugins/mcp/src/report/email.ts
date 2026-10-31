import { periodLabel } from "../scraper/email.js";
import type { Overview, Stats } from "./overview.js";
import { FULL_TEXT_MAX, type Item, type Source } from "./sources.js";

const COLORS = { negative: "#e34948", neutral: "#8a8982", positive: "#2a78d6" } as const;
const SOURCE: Record<Source, string> = { "2gis": "2ГИС", threads: "Threads" };

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const TH = 'style="text-align:left;padding:8px 10px;border-bottom:2px solid #e6e5e1;color:#52514e;font-size:12px"';
const TD = 'style="padding:8px 10px;border-bottom:1px solid #e6e5e1;vertical-align:top;font-size:13px"';
const TDN = 'style="padding:8px 10px;border-bottom:1px solid #e6e5e1;text-align:right;font-size:13px;white-space:nowrap"';

function when(value: string | null, timezone: string): string {
  const ms = Date.parse(String(value || ""));
  return Number.isNaN(ms) ? "" : new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: timezone });
}

/** Static, script-free email body; the interactive page goes as an attachment. */
export function combinedEmailHtml(
  overview: Overview,
  stats: Stats,
  items: Item[],
  hours: number,
  timezone: string
): string {
  const byId = new Map(items.map((item) => [item.id, item]));
  // The list repeats nothing earlier emails already had; the attached page still has everything.
  const allNegatives = items.filter((item) => item.relevant && item.sentiment === "negative");
  const negatives = allNegatives.filter((item) => !item.sent_at).slice(0, 40);
  const seenNegatives = allNegatives.length - allNegatives.filter((item) => !item.sent_at).length;
  const neutrals = items.filter((item) => item.relevant && item.sentiment === "neutral" && !item.sent_at).slice(0, 40);
  const fresh = items.filter((item) => !item.sent_at).length;
  const summary = overview.summary
    ? overview.summary
        .split(/\n\s*\n/)
        .map((p) => `<p style="margin:0 0 10px;line-height:1.55">${esc(p.trim())}</p>`)
        .join("")
    : `<p style="color:#6b6a65">${esc(overview.note)}</p>`;
  const problems = overview.problems.length
    ? overview.problems
        .map((problem) => {
          const examples = problem.example_ids
            .map((id) => byId.get(id))
            .filter((item): item is Item => Boolean(item))
            .map(
              (item) =>
                `<li><a href="${esc(item.url)}" style="color:#1c5cab">${SOURCE[item.source]}</a> — ${esc((item.summary || item.text).slice(0, 140))}</li>`
            )
            .join("");
          return (
            `<div style="border-left:3px solid ${COLORS.negative};padding:6px 12px;margin:10px 0">` +
            `<b>${esc(problem.title)}</b> <span style="color:#52514e">· ${problem.count} упом. · ${problem.sources.map((s) => SOURCE[s]).join(", ")}</span>` +
            (problem.description ? `<div style="color:#52514e;font-size:14px;margin-top:4px">${esc(problem.description)}</div>` : "") +
            (examples ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:#52514e">${examples}</ul>` : "") +
            "</div>"
          );
        })
        .join("")
    : '<p style="color:#6b6a65">Негативных упоминаний за период нет.</p>';
  const sourceRow = (source: Source) => {
    const s = stats.by_source[source];
    return (
      `<tr><td ${TD}>${SOURCE[source]}</td><td ${TDN}><b style="color:${COLORS.negative}">${s.negative}</b></td>` +
      `<td ${TDN}>${s.neutral}</td><td ${TDN}><b style="color:${COLORS.positive}">${s.positive}</b></td>` +
      `<td ${TDN}>${s.irrelevant}</td><td ${TDN}>${s.not_analyzed}</td></tr>`
    );
  };
  const negativeRows = negatives
    .map(
      (item) =>
        `<tr><td ${TD}>${esc(when(item.published_at, timezone))}</td><td ${TD}>${SOURCE[item.source]}</td>` +
        `<td ${TD}>${esc(item.place)}</td><td ${TDN}>${item.rating ?? "—"}</td>` +
        `<td ${TD}>${esc(item.summary || item.text.slice(0, 240))}</td>` +
        `<td ${TD}><a href="${esc(item.url)}" style="color:#1c5cab">открыть</a></td></tr>`
    )
    .join("");
  const textCell = (item: Item) =>
    (item.summary ? `<b>${esc(item.summary)}</b><br>` : "") + esc(item.text).replace(/\n/g, "<br>");
  const neutralRows = neutrals
    .map(
      (item) =>
        `<tr><td ${TD}>${esc(when(item.published_at, timezone))}</td><td ${TD}>${SOURCE[item.source]}</td>` +
        `<td ${TD}>${esc(item.author)}<br>${esc(item.place)}</td>` +
        `<td ${TD}>${textCell(item)}</td>` +
        `<td ${TD}><a href="${esc(item.url)}" style="color:#1c5cab">открыть</a></td></tr>`
    )
    .join("");
  const everyRow = items
    .map(
      (item) =>
        `<tr><td ${TD}>${esc(when(item.published_at, timezone))}</td><td ${TD}>${SOURCE[item.source]}</td>` +
        `<td ${TD}>${esc(item.author)}<br>${esc(item.place)}</td>` +
        `<td ${TD}>${textCell(item)}</td>` +
        `<td ${TD}><a href="${esc(item.url)}" style="color:#1c5cab">открыть</a></td></tr>`
    )
    .join("");
  return [
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head>',
    '<body style="margin:0;background:#f5f5f3;font-family:Segoe UI,Arial,sans-serif;color:#0b0b0b">',
    '<div style="max-width:880px;margin:0 auto;padding:24px 16px">',
    '<div style="background:#01080A;color:#fff;border-radius:14px;padding:20px 22px">',
    '<div style="color:#D50032;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">NarxozScraper</div>',
    `<div style="font-size:22px;font-weight:650;margin:6px 0">2ГИС и Threads за ${esc(periodLabel(hours))}</div>`,
    `<div style="color:#c9cdd3;font-size:13px">Релевантных: ${stats.relevant} · негатив ${stats.sentiment.negative} · ` +
      `нейтрально ${stats.sentiment.neutral} · позитив ${stats.sentiment.positive}` +
      (stats.avg_rating_2gis != null ? ` · ★ 2ГИС ${stats.avg_rating_2gis}` : "") +
      (overview.model ? ` · анализ: ${esc(overview.model)}` : "") +
      `<br>Новых с прошлого письма: ${fresh} из ${items.length}` +
      "</div></div>",
    '<div style="background:#fcfcfb;border:1px solid #e6e5e1;border-radius:14px;padding:6px 18px 18px;margin-top:16px">',
    '<h2 style="font-size:16px;margin:16px 0 8px">Общий анализ</h2>',
    summary,
    '<h2 style="font-size:16px;margin:20px 0 4px">Главные проблемы</h2>',
    problems,
    '<h2 style="font-size:16px;margin:20px 0 6px">По источникам</h2>',
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">',
    `<tr><th ${TH}>Источник</th><th ${TH}>Негатив</th><th ${TH}>Нейтрально</th><th ${TH}>Позитив</th><th ${TH}>Нерелевантные</th><th ${TH}>Без анализа</th></tr>`,
    sourceRow("2gis"),
    sourceRow("threads"),
    "</table>",
    negatives.length
      ? `<h2 style="font-size:16px;margin:20px 0 6px;color:${COLORS.negative}">Новые негативные упоминания · ${negatives.length}</h2>` +
        '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
        `<tr><th ${TH}>Дата</th><th ${TH}>Источник</th><th ${TH}>Место</th><th ${TH}>★</th><th ${TH}>Суть</th><th ${TH}></th></tr>` +
        negativeRows +
        "</table>"
      : "",
    neutrals.length && items.length > FULL_TEXT_MAX
      ? `<h2 style="font-size:16px;margin:20px 0 6px;color:${COLORS.neutral}">Новые нейтральные упоминания · ${neutrals.length}</h2>` +
        '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
        `<tr><th ${TH}>Дата</th><th ${TH}>Источник</th><th ${TH}>Автор</th><th ${TH}>Суть и текст</th><th ${TH}></th></tr>` +
        neutralRows +
        "</table>"
      : "",
    items.length && items.length <= FULL_TEXT_MAX
      ? `<h2 style="font-size:16px;margin:20px 0 6px">Все упоминания · ${items.length}</h2>` +
        '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
        `<tr><th ${TH}>Дата</th><th ${TH}>Источник</th><th ${TH}>Автор</th><th ${TH}>Текст</th><th ${TH}></th></tr>` +
        everyRow +
        "</table>"
      : "",
    seenNegatives
      ? `<p style="color:#6b6a65;font-size:13px">Ещё ${seenNegatives} негативных уже были в прошлых письмах — они в отчёте, фильтр «Ранее показанные».</p>`
      : "",
    "</div>",
    '<p style="color:#6b6a65;font-size:12px;margin-top:16px">Полный отчёт с графиками и фильтрами — во вложении (report.html).</p>',
    "</div></body></html>",
  ].join("\n");
}
