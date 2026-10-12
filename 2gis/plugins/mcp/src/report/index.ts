import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../scraper/config.js";
import { periodLabel, smtpSetup } from "../scraper/email.js";
import { combinedEmailHtml } from "./email.js";
import { renderReport } from "./html.js";
import { buildOverview, computeStats, periodWords } from "./overview.js";
import { inPeriod, loadItems, reportPath } from "./sources.js";

export type ReportOptions = {
  hours?: number;
  /** false skips the LLM summary (numbers and topic-based problems only). */
  overview?: boolean;
  email?: boolean;
  to?: string[];
};

/** Builds the combined 2GIS + Threads report, writes it, and optionally emails it. */
export async function generateReport(root: string, options: ReportOptions = {}): Promise<Record<string, unknown>> {
  const cfg = loadConfig(root);
  const timezone = cfg.timezone || "Asia/Almaty";
  const hours = options.hours && options.hours > 0 ? options.hours : cfg.report.period_hours || 168;
  const { items: all, threads_root } = loadItems(root);
  const items = inPeriod(all, hours);
  const stats = computeStats(items, hours, timezone);
  const { overview, errors } = await buildOverview(root, items, hours, { useLlm: options.overview });

  const file = reportPath(root);
  mkdirSync(dirname(file), { recursive: true });
  const html = renderReport({
    generated_at: new Date().toISOString(),
    timezone,
    period_hours: hours,
    period_label: periodWords(hours),
    overview,
    stats,
    threads_connected: Boolean(threads_root),
    items,
  });
  writeFileSync(file, html, "utf8");

  let email: Record<string, unknown> | null = null;
  if (options.email) {
    const { to, from, transport } = smtpSetup(root, options.to);
    const info = await transport.sendMail({
      from,
      to,
      subject: cfg.report.subject.replace("{period}", periodLabel(hours)),
      html: combinedEmailHtml(overview, stats, items, hours, timezone),
      attachments: [{ filename: "narxoz-report.html", content: html, contentType: "text/html" }],
    });
    email = { sent_to: to, from, message_id: info.messageId };
  }

  if (!threads_root) {
    errors.push("Threads: data/posts.jsonl не найден — задайте report.threads_root или NARXOZ_SCRAPER_ROOT");
  }
  return {
    report: file,
    period_hours: hours,
    threads_root,
    mentions: stats.total,
    relevant: stats.relevant,
    irrelevant: stats.irrelevant,
    not_analyzed: stats.not_analyzed,
    sentiment: stats.sentiment,
    by_source: stats.by_source,
    overview_model: overview.model,
    problems: overview.problems.map((problem) => `${problem.title} (${problem.count})`),
    email,
    errors,
  };
}
