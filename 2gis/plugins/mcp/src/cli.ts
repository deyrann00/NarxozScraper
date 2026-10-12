import { scraperRoot } from "./repo.js";
import { analyzeReviews } from "./scraper/analyze.js";
import { sendReport } from "./scraper/email.js";
import { scrapeOnce } from "./scraper/run.js";
import { writeHtml } from "./scraper/view.js";

const USAGE = `Usage: node server/index.js <command> [options]

Without a command the MCP server starts on stdio.

Commands:
  run        Collect new reviews, analyse them with the LLM, rebuild data/index.html
  analyze    Analyse saved reviews only (no scraping)
  email      Email the report only (no scraping)
  help       Show this message

Options:
  --full         run: backfill the archive up to max_reviews_per_branch
  --email        run: email the report after collecting
  --to a@b,c@d   email recipients (default: email.to in config.json)
  --hours N      report window for --email / email (default: email.period_hours);
                 analyze: only reviews from the last N hours
  --force        analyze: re-classify reviews that already have an analysis

Secrets come from the environment: OPENROUTER_API_KEY, SMTP_USER, SMTP_PASS.
Exit code is 0 on success and 1 when the scrape or the email failed.`;

type Flags = { full: boolean; email: boolean; force: boolean; to?: string[]; hours?: number };

function parseArgs(args: string[]): Flags {
  const flags: Flags = { full: false, email: false, force: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [name, inline] = arg.split("=", 2);
    const value = () => {
      const next = inline ?? args[++i];
      if (next === undefined) throw new Error(`${name} needs a value`);
      return next;
    };
    switch (name) {
      case "--full":
        flags.full = true;
        break;
      case "--email":
        flags.email = true;
        break;
      case "--force":
        flags.force = true;
        break;
      case "--to":
        flags.to = value()
          .split(",")
          .map((address) => address.trim())
          .filter(Boolean);
        break;
      case "--hours": {
        const hours = Number(value());
        if (!Number.isInteger(hours) || hours < 0) throw new Error("--hours must be a whole number of hours");
        flags.hours = hours;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One-shot command for cron / Docker; returns the process exit code. */
export async function runCli(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE + "\n");
    return command ? 0 : 1;
  }
  let flags: Flags;
  try {
    flags = parseArgs(rest);
  } catch (err) {
    process.stderr.write(`${message(err)}\n\n${USAGE}\n`);
    return 1;
  }

  const root = scraperRoot();
  const started = new Date().toISOString();
  try {
    if (command === "run") {
      const summary = await scrapeOnce(root, flags.full);
      let email: unknown = null;
      let failed = false;
      if (flags.email) {
        try {
          email = await sendReport(root, { to: flags.to, hours: flags.hours });
        } catch (err) {
          email = { error: message(err) };
          failed = true;
        }
      }
      print({ command, started, ...summary, email });
      return failed ? 1 : 0;
    }
    if (command === "analyze") {
      const result = await analyzeReviews(root, { force: flags.force, hours: flags.hours ?? 0 });
      print({ command, started, ...result, dashboard: writeHtml(root) });
      return 0;
    }
    if (command === "email") {
      print({ command, started, ...(await sendReport(root, { to: flags.to, hours: flags.hours })) });
      return 0;
    }
  } catch (err) {
    process.stderr.write(`${command} failed: ${message(err)}\n`);
    return 1;
  }
  process.stderr.write(`Unknown command: ${command}\n\n${USAGE}\n`);
  return 1;
}
