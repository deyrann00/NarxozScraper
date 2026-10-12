// 2GIS serves an "update your browser" stub to unknown or old user agents.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30_000;

async function get(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ru-RU,ru;q=0.9",
      Accept: accept,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response;
}

export async function fetchText(url: string): Promise<string> {
  return (await get(url, "text/html")).text();
}

export async function fetchJson<T>(url: string): Promise<T> {
  return (await (await get(url, "application/json")).json()) as T;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
