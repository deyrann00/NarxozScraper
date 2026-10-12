import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { paths, threadsCredentials, type AppConfig } from "./config.js";
import { getChromium } from "./playwright.js";
import {
  ingestPayload,
  parentCard,
  parseThreadGroup,
  payloadsFromHtml,
  searchUrl,
  walkThreadGroups,
  type Post,
} from "./parse.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export class LoginRequired extends Error {}

async function openContext(
  root: string,
  headless: boolean
): Promise<{ context: BrowserContext; browser?: Browser }> {
  const loc = paths(root);
  const chromium = await getChromium();
  const launch = {
    headless,
    viewport: { width: 1280, height: 900 },
    userAgent: USER_AGENT,
    locale: "ru-RU",
  };
  if (existsSync(loc.browserProfile) && readdirSync(loc.browserProfile).length) {
    const context = await chromium.launchPersistentContext(loc.browserProfile, launch);
    return { context };
  }
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: launch.viewport,
    userAgent: USER_AGENT,
    locale: "ru-RU",
    storageState: existsSync(loc.storageState) ? loc.storageState : undefined,
  });
  return { context, browser };
}

async function dismissCookies(page: Page): Promise<void> {
  for (const label of ["Allow all cookies", "Allow cookies", "Accept all", "Принять все", "Разрешить все"]) {
    try {
      const button = page.getByRole("button", { name: label });
      if ((await button.count()) && (await button.first().isVisible())) {
        await button.first().click({ timeout: 1500 });
      }
    } catch {
      /* ignore */
    }
  }
}

async function loginWithEnv(page: Page, username: string, password: string): Promise<void> {
  await dismissCookies(page);
  for (const label of [
    "Log in with Instagram",
    "Continue with Instagram",
    "Log in",
    "Войти через Instagram",
    "Войти",
  ]) {
    const button = page.getByRole("button", { name: label });
    try {
      if ((await button.count()) && (await button.first().isVisible())) {
        await button.first().click({ timeout: 2000 });
        await page.waitForTimeout(1200);
        break;
      }
    } catch {
      /* ignore */
    }
  }
  const userBox = page.locator(
    'input[name="username"], input[aria-label*="username" i], input[aria-label*="email" i], input[autocomplete="username"]'
  );
  const passBox = page.locator('input[name="password"], input[type="password"]');
  await userBox.first().waitFor({ state: "visible", timeout: 20000 });
  await userBox.first().fill(username);
  await passBox.first().fill(password);
  const submit = page.locator('button[type="submit"]');
  if (await submit.count()) {
    await submit.first().click();
  } else {
    await page.keyboard.press("Enter");
  }
  const leftLogin = (url: URL) =>
    !url.href.toLowerCase().includes("login") && !url.href.toLowerCase().includes("challenge");
  try {
    await page.waitForURL(leftLogin, { timeout: 25000 });
  } catch {
    await page.waitForURL(leftLogin, { timeout: 180000 });
  }
}

export async function saveLoginSession(root: string): Promise<string> {
  const creds = threadsCredentials();
  if (!creds) {
    throw new LoginRequired(
      `Set THREADS_USERNAME and THREADS_PASSWORD in ${join(root, ".env")}, then login again.`
    );
  }
  const loc = paths(root);
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(loc.browserProfile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent: USER_AGENT,
    locale: "ru-RU",
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.threads.com/login", { waitUntil: "domcontentloaded" });
  await loginWithEnv(page, creds.username, creds.password);
  await context.storageState({ path: loc.storageState });
  await context.close();
  return loc.storageState;
}

function loginWall(html: string, page: Page): boolean {
  const blob = html.toLowerCase();
  const markers = ["log in to see", "log in or sign up", "войдите, чтобы", "continue with instagram"];
  return markers.some((marker) => blob.includes(marker)) || page.url().includes("threads.com/login");
}

async function scroll(page: Page, maxScrolls: number): Promise<void> {
  for (let i = 0; i < maxScrolls; i += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);
  }
}

async function fillMissingParents(page: Page, posts: Record<string, Post>, query: string, limit: number): Promise<void> {
  const need = Object.values(posts).filter(
    (post) => post.url && !(post.parent as Post | undefined)?.text && (post.is_reply || post.reply_to)
  );
  const payloads: unknown[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("graphql") && !url.includes("text_post_app")) {
      return;
    }
    try {
      payloads.push(await response.json());
    } catch {
      /* ignore */
    }
  });
  const byCode = new Map(
    Object.values(posts)
      .filter((post) => post.code)
      .map((post) => [String(post.code), post])
  );
  for (const post of need.slice(0, limit)) {
    payloads.length = 0;
    const target = String(post.code || "");
    try {
      await page.goto(String(post.url), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      payloads.push(...payloadsFromHtml(await page.content()));
    } catch {
      continue;
    }
    let attached = false;
    for (const payload of payloads) {
      if (attached || !target) {
        break;
      }
      for (const group of walkThreadGroups(payload)) {
        const parsed = parseThreadGroup(group, query, "threads_browser");
        const codes = parsed.map((item) => String(item.code || ""));
        const idx = codes.indexOf(target);
        if (idx <= 0) {
          continue;
        }
        const parent = parsed[0];
        const child = byCode.get(target) || post;
        child.is_reply = true;
        child.reply_to = parent.username;
        child.parent = parentCard(parent);
        attached = true;
        break;
      }
    }
  }
}

export async function searchBrowser(root: string, query: string, cfg: AppConfig): Promise<Post[]> {
  const posts: Record<string, Post> = {};
  const filters = cfg.search_filters || ["default", "recent"];
  const cap = cfg.max_posts_per_query || 80;
  const { context, browser } = await openContext(root, Boolean(cfg.headless));
  const page = await context.newPage();
  const payloads: unknown[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("graphql") && !url.includes("text_post_app")) {
      return;
    }
    try {
      payloads.push(await response.json());
    } catch {
      /* ignore */
    }
  });
  try {
    for (const filterName of filters) {
      await page.goto(searchUrl(query, filterName), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      const html = await page.content();
      if (loginWall(html, page)) {
        throw new LoginRequired(
          "Threads asked for login. Call login_narxoz_threads or set THREADS_USERNAME / THREADS_PASSWORD in .env."
        );
      }
      await scroll(page, cfg.max_scrolls || 10);
      payloads.push(...payloadsFromHtml(await page.content()));
      if (Object.keys(posts).length >= cap) {
        break;
      }
    }
    for (const payload of payloads) {
      ingestPayload(payload, query, "threads_browser", posts);
    }
    await fillMissingParents(page, posts, query, 12);
  } finally {
    await context.close();
    await browser?.close();
  }
  return Object.values(posts).slice(0, cap);
}
