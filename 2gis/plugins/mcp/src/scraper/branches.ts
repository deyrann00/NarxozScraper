import type { AppConfig } from "./config.js";
import { fetchText } from "./http.js";

export type Branch = {
  id: string;
  name: string;
  address: string;
  org_id: string;
  rubrics: string[];
  rating: number | null;
  reviews_count: number | null;
  url: string;
};

export type Discovery = {
  branches: Branch[];
  apiKey?: string;
  errors: string[];
};

const STATE_MARKER = "initialState = JSON.parse('";
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

/** Accepts a bare branch id or any 2GIS URL that contains `/firm/<id>`. */
export function branchId(value: string): string | undefined {
  const raw = String(value).trim();
  if (/^\d{6,}$/.test(raw)) {
    return raw;
  }
  return /\/firm\/(\d{6,})/.exec(raw)?.[1];
}

export function branchUrl(cfg: AppConfig, id: string): string {
  return `https://${cfg.domain}/${cfg.city}/firm/${id}`;
}

/** Decode the single-quoted JS string literal starting at `start`. */
function readJsString(html: string, start: number): string {
  const out: string[] = [];
  let i = start;
  let chunk = start;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "'") {
      out.push(html.slice(chunk, i));
      return out.join("");
    }
    if (ch !== "\\") {
      i += 1;
      continue;
    }
    out.push(html.slice(chunk, i));
    const next = html[i + 1];
    if (next === "u") {
      out.push(String.fromCharCode(parseInt(html.slice(i + 2, i + 6), 16)));
      i += 6;
    } else if (next === "x") {
      out.push(String.fromCharCode(parseInt(html.slice(i + 2, i + 4), 16)));
      i += 4;
    } else {
      out.push(ESCAPES[next] ?? next);
      i += 2;
    }
    chunk = i;
  }
  throw new Error("2GIS page state is not terminated");
}

/**
 * 2GIS server-renders every page with its store serialised into
 * `var initialState = JSON.parse('...')`; firm cards sit in `data.entity.profile`.
 */
function pageBranches(html: string, cfg: AppConfig): Branch[] {
  const at = html.indexOf(STATE_MARKER);
  if (at < 0) {
    throw new Error("2GIS page has no initialState (layout changed or request was blocked)");
  }
  const state = JSON.parse(readJsString(html, at + STATE_MARKER.length));
  const profiles = (state?.data?.entity?.profile ?? {}) as Record<string, { data?: any }>;
  const branches: Branch[] = [];
  for (const [id, entry] of Object.entries(profiles)) {
    const data = entry?.data;
    if (!data || data.type !== "branch") {
      continue;
    }
    branches.push({
      id,
      name: String(data.name || ""),
      address: String(data.address_name || ""),
      org_id: String(data.org?.id || ""),
      rubrics: Array.isArray(data.rubrics) ? data.rubrics.map((r: any) => String(r?.name || "")).filter(Boolean) : [],
      rating: typeof data.reviews?.general_rating === "number" ? data.reviews.general_rating : null,
      reviews_count:
        typeof data.reviews?.general_review_count === "number" ? data.reviews.general_review_count : null,
      url: branchUrl(cfg, id),
    });
  }
  return branches;
}

function pageApiKey(html: string): string | undefined {
  return /"reviewApiKey":"([0-9a-f-]{20,})"/.exec(html)?.[1];
}

function ids(values: string[]): Set<string> {
  return new Set(values.map(branchId).filter((id): id is string => Boolean(id)));
}

/**
 * Find the branches to track: search results whose name passes `name_filters`
 * (plus siblings of the same organisation), plus everything in `branches`,
 * minus everything in `exclude_branches`.
 */
export async function discoverBranches(cfg: AppConfig): Promise<Discovery> {
  const errors: string[] = [];
  const candidates = new Map<string, Branch>();
  let apiKey: string | undefined;

  for (const query of cfg.queries) {
    const url = `https://${cfg.domain}/${cfg.city}/search/${encodeURIComponent(query)}`;
    try {
      const html = await fetchText(url);
      apiKey ??= pageApiKey(html);
      for (const branch of pageBranches(html, cfg)) {
        candidates.set(branch.id, branch);
      }
    } catch (err) {
      errors.push(`Search "${query}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const filters = cfg.name_filters.map((f) => f.toLowerCase().trim()).filter(Boolean);
  const named = [...candidates.values()].filter(
    (branch) => !filters.length || filters.some((f) => branch.name.toLowerCase().includes(f))
  );
  // A dormitory or a department can carry its own name yet belong to the same organisation.
  const orgs = new Set(named.map((branch) => branch.org_id).filter(Boolean));
  const tracked = new Map<string, Branch>();
  for (const branch of candidates.values()) {
    if (named.includes(branch) || orgs.has(branch.org_id)) {
      tracked.set(branch.id, branch);
    }
  }

  for (const id of ids(cfg.branches)) {
    if (tracked.has(id)) {
      continue;
    }
    let found = candidates.get(id);
    if (!found) {
      try {
        const html = await fetchText(branchUrl(cfg, id));
        apiKey ??= pageApiKey(html);
        found = pageBranches(html, cfg).find((branch) => branch.id === id);
      } catch (err) {
        errors.push(`Branch ${id} lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    tracked.set(
      id,
      found ?? {
        id,
        name: id,
        address: "",
        org_id: "",
        rubrics: [],
        rating: null,
        reviews_count: null,
        url: branchUrl(cfg, id),
      }
    );
  }

  for (const id of ids(cfg.exclude_branches)) {
    tracked.delete(id);
  }
  return { branches: [...tracked.values()], apiKey, errors };
}
