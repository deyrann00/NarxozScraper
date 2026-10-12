import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { loadConfig, paths } from "./config.js";
import type { Review } from "./parse.js";
import { loadBranches, loadExisting, lookbackReviews, mergeReviews } from "./store.js";

// The page script avoids template literals so this file can hold it in one.
const TEMPLATE = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Narxoz · 2GIS</title>
  <style>
    :root {
      --red: #D50032;
      --dark: #01080A;
      --ink: #1a1a1a;
      --muted: #667085;
      --line: #e8eaed;
      --bg: #F5F5F6;
      --card: #fff;
      --star: #F5A623;
      --pos: #1F9D55;
      --pos-bg: #E8F6EE;
      --neu: #8A6D1D;
      --neu-bg: #FBF4E2;
      --neg: #D50032;
      --neg-bg: #FDE8ED;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      background: var(--dark);
      color: #fff;
      padding: 28px 20px 40px;
    }
    .wrap { max-width: 1040px; margin: 0 auto; }
    .kicker {
      color: var(--red);
      font-size: 12px;
      letter-spacing: .12em;
      text-transform: uppercase;
      font-weight: 700;
    }
    h1 { margin: 8px 0 6px; font-size: 28px; font-weight: 650; }
    .sub { color: #c9cdd3; font-size: 14px; }
    .toolbar { margin-top: -22px; padding: 0 20px 6px; }
    .toolbar .wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 8px 24px rgba(1,8,10,.06);
    }
    .seg { display: flex; background: var(--bg); border-radius: 999px; padding: 4px; }
    .seg button {
      border: 0;
      background: transparent;
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      color: var(--muted);
    }
    .seg button.active { background: var(--red); color: #fff; }
    input[type="search"], select {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    input[type="search"] { flex: 1; min-width: 180px; }
    select { max-width: 100%; }
    .check { display: flex; gap: 6px; align-items: center; font-size: 14px; color: var(--muted); cursor: pointer; }
    .stats { color: var(--muted); font-size: 13px; padding: 4px 6px; width: 100%; }
    main { padding: 0 20px 40px; }
    .branches {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px;
      margin: 14px 0 4px;
    }
    .branch {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      font-size: 13px;
    }
    .branch a { color: inherit; text-decoration: none; font-weight: 700; }
    .branch a:hover { color: var(--red); }
    .branch .addr { color: var(--muted); margin: 2px 0 8px; }
    .branch .score { font-size: 18px; font-weight: 700; }
    .branch .score span { color: var(--muted); font-size: 13px; font-weight: 400; }
    .conversation {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      margin: 12px 0;
      overflow: hidden;
    }
    .card { padding: 16px 18px; }
    .card.answer { border-top: 1px solid var(--line); background: #fafafa; }
    .label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .card.answer.org .label { color: var(--red); }
    .meta { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .user { font-weight: 700; }
    .when { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .place { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .stars { color: var(--star); letter-spacing: 2px; margin-top: 6px; }
    .stars.low { color: var(--red); }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; margin: 10px 0 12px; }
    .card.answer .text { margin-bottom: 0; }
    .foot { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
    .foot a { color: #2b6cb0; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .badge {
      font-size: 12px;
      border-radius: 999px;
      padding: 3px 10px;
      background: var(--bg);
      color: var(--muted);
    }
    .badge.positive { background: var(--pos-bg); color: var(--pos); font-weight: 600; }
    .badge.neutral { background: var(--neu-bg); color: var(--neu); font-weight: 600; }
    .badge.negative { background: var(--neg-bg); color: var(--neg); font-weight: 600; }
    .badge.irrelevant { background: #eee; color: #777; font-weight: 600; }
    .gist { color: var(--muted); font-size: 14px; margin-top: 8px; font-style: italic; }
    .conversation.irrelevant { opacity: .6; }
    .seg .count { opacity: .75; font-size: 12px; margin-left: 4px; }
    .panel {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      margin: 14px 0;
      overflow-x: auto;
    }
    .panel h2 { font-size: 14px; margin: 0; padding: 12px 14px 0; color: var(--muted); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 12px; white-space: nowrap; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td.pos { color: var(--pos); font-weight: 600; }
    td.neu { color: var(--neu); font-weight: 600; }
    td.neg { color: var(--neg); font-weight: 600; }
    tr.row-positive td:first-child { box-shadow: inset 3px 0 0 var(--pos); }
    tr.row-neutral td:first-child { box-shadow: inset 3px 0 0 var(--star); }
    tr.row-negative td:first-child { box-shadow: inset 3px 0 0 var(--neg); }
    tr.row-irrelevant { color: #999; }
    tfoot td { font-weight: 700; border-bottom: 0; }
    td a { color: #2b6cb0; }
    #feed td:first-child { white-space: nowrap; }
    .empty { text-align: center; padding: 48px 16px; color: var(--muted); }
    .empty strong { color: var(--ink); display: block; margin-bottom: 6px; font-size: 18px; }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="kicker">Narxoz2GisScraper</div>
      <h1>2ГИС · Нархоз</h1>
      <div class="sub" id="generated"></div>
    </div>
  </header>
  <div class="toolbar">
    <div class="wrap">
      <div class="seg">
        <button id="btn24" type="button">24 часа</button>
        <button id="btn7" class="active" type="button">7 дней</button>
        <button id="btnAll" type="button">Все</button>
      </div>
      <div class="seg" id="sentiments">
        <button data-s="" class="active" type="button">Все</button>
        <button data-s="negative" type="button">Негативные<span class="count"></span></button>
        <button data-s="neutral" type="button">Нейтральные<span class="count"></span></button>
        <button data-s="positive" type="button">Позитивные<span class="count"></span></button>
      </div>
      <div class="seg" id="views">
        <button data-v="feed" class="active" type="button">Лента</button>
        <button data-v="table" type="button">Таблица</button>
      </div>
      <select id="branch"></select>
      <label class="check"><input id="low" type="checkbox"> только 1–3★</label>
      <label class="check"><input id="irrelevant" type="checkbox"> показать нерелевантные</label>
      <input id="q" type="search" placeholder="Поиск по тексту, автору, ответам">
      <div class="stats" id="stats"></div>
    </div>
  </div>
  <main class="wrap">
    <div class="branches" id="branches"></div>
    <div class="panel"><h2>Сводка по филиалам за период</h2><table id="summary"></table></div>
    <div id="feed"></div>
  </main>
  <script>
    const DATA = __PAYLOAD__;
    const HOURS = { "24h": DATA.lookback_hours || 24, "7d": DATA.week_hours || 168, "all": 0 };
    const buttons = { "24h": document.getElementById("btn24"), "7d": document.getElementById("btn7"), "all": document.getElementById("btnAll") };
    let range = "7d";
    let sentiment = "";
    let view = "feed";
    const SENTIMENT_LABEL = { positive: "Позитивный", neutral: "Нейтральный", negative: "Негативный" };
    const showIrrelevant = document.getElementById("irrelevant");
    const summaryTable = document.getElementById("summary");
    const feed = document.getElementById("feed");
    const stats = document.getElementById("stats");
    const search = document.getElementById("q");
    const branchSelect = document.getElementById("branch");
    const lowOnly = document.getElementById("low");

    function formatWhen(value) {
      const dt = value ? new Date(value) : null;
      if (!dt || Number.isNaN(dt.getTime())) return "";
      return dt.toLocaleString("ru-KZ", { dateStyle: "medium", timeStyle: "short", timeZone: DATA.timezone });
    }
    function escapeHtml(text) {
      return String(text == null ? "" : text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }
    function starsHtml(rating) {
      if (!rating) return "";
      return '<div class="stars' + (rating <= 3 ? " low" : "") + '" title="' + rating + ' из 5">' +
        "★".repeat(rating) + "☆".repeat(5 - rating) + "</div>";
    }
    function replyCard(reply) {
      return '<article class="card answer' + (reply.from_org ? " org" : "") + '">' +
        '<div class="label">' + (reply.from_org ? "Ответ организации" : "Ответ пользователя") + "</div>" +
        '<div class="meta"><div class="user">' + escapeHtml(reply.author || "Без имени") + "</div>" +
        '<div class="when">' + escapeHtml(formatWhen(reply.published_at)) + "</div></div>" +
        '<div class="text">' + escapeHtml(reply.text) + "</div></article>";
    }
    function badgesHtml(review) {
      if (!review.sentiment) return "";
      const head = review.relevant === false
        ? '<span class="badge irrelevant">Нерелевантный</span>'
        : '<span class="badge ' + review.sentiment + '">' + SENTIMENT_LABEL[review.sentiment] + "</span>";
      return '<div class="badges">' + head +
        (review.topics || []).map((topic) => '<span class="badge">' + escapeHtml(topic) + "</span>").join("") + "</div>";
    }
    function reviewBlock(review) {
      const link = escapeHtml(review.url);
      return '<div class="conversation' + (review.relevant === false ? " irrelevant" : "") + '"><article class="card">' +
        '<div class="meta"><div class="user">' + escapeHtml(review.author || "Без имени") + "</div>" +
        '<div class="when">' + escapeHtml(formatWhen(review.published_at)) + "</div></div>" +
        '<div class="place">' + escapeHtml(review.branch_name) + " · " + escapeHtml(review.branch_address) + "</div>" +
        starsHtml(review.rating) +
        badgesHtml(review) +
        (review.summary ? '<div class="gist">' + escapeHtml(review.summary) + "</div>" : "") +
        '<div class="text">' + escapeHtml(review.text) + "</div>" +
        '<div class="foot"><span>♥ ' + review.likes_count + "</span>" +
        "<span>💬 " + review.replies_count + "</span>" +
        (review.photos_count ? "<span>📷 " + review.photos_count + "</span>" : "") +
        '<a href="' + link + '" target="_blank" rel="noopener">Открыть в 2ГИС</a></div></article>' +
        review.replies.map(replyCard).join("") + "</div>";
    }
    function tableHtml(reviews) {
      return '<thead><tr><th>Дата</th><th>Филиал</th><th class="num">★</th><th>Тональность</th><th>Темы</th>' +
        "<th>Суть / текст</th><th></th></tr></thead><tbody>" +
        reviews.map((review) => {
          const kind = review.relevant === false ? "irrelevant" : (review.sentiment || "");
          const label = review.relevant === false ? "Нерелевантный" : (SENTIMENT_LABEL[review.sentiment] || "—");
          const gist = review.summary || String(review.text || "").slice(0, 220);
          return '<tr class="row-' + kind + '"><td>' + escapeHtml(formatWhen(review.published_at)) + "</td>" +
            "<td>" + escapeHtml(review.branch_name) + "</td>" +
            '<td class="num">' + escapeHtml(review.rating || "—") + "</td>" +
            "<td>" + label + "</td>" +
            "<td>" + escapeHtml((review.topics || []).join(", ")) + "</td>" +
            "<td>" + escapeHtml(gist) + "</td>" +
            '<td><a href="' + escapeHtml(review.url) + '" target="_blank" rel="noopener">2ГИС</a></td></tr>';
        }).join("") + "</tbody>";
    }
    function summaryHtml(reviews) {
      const rows = {};
      const total = { name: "Итого", positive: 0, neutral: 0, negative: 0, irrelevant: 0, stars: 0, rated: 0 };
      reviews.forEach((review) => {
        const row = rows[review.branch_id] || (rows[review.branch_id] =
          { name: review.branch_name + " — " + review.branch_address, positive: 0, neutral: 0, negative: 0, irrelevant: 0, stars: 0, rated: 0 });
        [row, total].forEach((target) => {
          if (review.relevant === false) target.irrelevant += 1;
          else if (review.sentiment) target[review.sentiment] += 1;
          if (review.rating) { target.stars += review.rating; target.rated += 1; }
        });
      });
      const line = (row, tag) => "<tr><" + tag + ">" + escapeHtml(row.name) + "</" + tag + ">" +
        '<td class="num neg">' + row.negative + '</td><td class="num neu">' + row.neutral + "</td>" +
        '<td class="num pos">' + row.positive + '</td><td class="num">' + row.irrelevant + "</td>" +
        '<td class="num">' + (row.rated ? (row.stars / row.rated).toFixed(1) : "—") + "</td></tr>";
      const body = Object.keys(rows).map((key) => rows[key])
        .sort((a, b) => b.negative - a.negative || a.name.localeCompare(b.name))
        .map((row) => line(row, "td")).join("");
      return '<thead><tr><th>Филиал</th><th class="num">Негатив</th><th class="num">Нейтрально</th>' +
        '<th class="num">Позитив</th><th class="num">Нерелевантные</th><th class="num">Ср. ★</th></tr></thead>' +
        "<tbody>" + (body || '<tr><td colspan="6">Нет отзывов за период</td></tr>') + "</tbody>" +
        (body ? "<tfoot>" + line(total, "td") + "</tfoot>" : "");
    }
    function render() {
      const hours = HOURS[range];
      const cutoff = hours ? Date.now() - hours * 3600 * 1000 : 0;
      const needle = search.value.trim().toLowerCase();
      // Period and branch scope the summary table; the other filters narrow the list below it.
      const scoped = DATA.reviews.filter((review) => {
        if (cutoff && !(Date.parse(review.published_at) >= cutoff)) return false;
        if (branchSelect.value && review.branch_id !== branchSelect.value) return false;
        return true;
      });
      summaryTable.innerHTML = summaryHtml(scoped);
      const visible = scoped.filter((review) => {
        if (!showIrrelevant.checked && review.relevant === false) return false;
        if (lowOnly.checked && !(review.rating && review.rating <= 3)) return false;
        if (!needle) return true;
        const haystack = [review.author, review.text, review.summary, (review.topics || []).join(" ")]
          .concat(review.replies.map((reply) => reply.author + " " + reply.text));
        return haystack.join(" ").toLowerCase().includes(needle);
      });
      document.querySelectorAll("#sentiments button[data-s]").forEach((button) => {
        const key = button.dataset.s;
        const count = button.querySelector(".count");
        if (count) count.textContent = visible.filter((review) => review.relevant !== false && review.sentiment === key).length;
      });
      const reviews = sentiment
        ? visible.filter((review) => review.relevant !== false && review.sentiment === sentiment)
        : visible;
      const rated = reviews.filter((review) => review.rating);
      const average = rated.length ? (rated.reduce((sum, review) => sum + review.rating, 0) / rated.length).toFixed(1) : "—";
      const answered = reviews.filter((review) => review.replies.some((reply) => reply.from_org)).length;
      stats.textContent = "Отзывов: " + reviews.length + " · средняя оценка: " + average + " · с ответом организации: " + answered;
      if (!reviews.length) {
        feed.innerHTML = '<div class="empty"><strong>Нет отзывов за этот период</strong>Смените фильтр или запустите новый сбор.</div>';
        return;
      }
      feed.innerHTML = view === "table"
        ? '<div class="panel"><table>' + tableHtml(reviews) + "</table></div>"
        : reviews.map(reviewBlock).join("");
    }
    function segment(selector, attr, apply) {
      document.querySelectorAll(selector + " button").forEach((button) => {
        button.onclick = () => {
          apply(button.dataset[attr]);
          document.querySelectorAll(selector + " button").forEach((other) => other.classList.toggle("active", other === button));
          render();
        };
      });
    }
    segment("#sentiments", "s", (value) => { sentiment = value; });
    segment("#views", "v", (value) => { view = value; });
    showIrrelevant.onchange = render;

    document.getElementById("generated").textContent =
      "Обновлено " + formatWhen(DATA.generated_at) + " · " + DATA.timezone + " · в архиве " + DATA.total_count +
      (DATA.llm_model ? " · анализ: " + (DATA.llm_model === "rating-fallback" ? "по звёздам" : DATA.llm_model) : "");
    branchSelect.innerHTML = '<option value="">Все филиалы</option>' + DATA.branches.map((branch) =>
      '<option value="' + escapeHtml(branch.id) + '">' + escapeHtml(branch.name + " — " + branch.address) + "</option>").join("");
    document.getElementById("branches").innerHTML = DATA.branches.map((branch) =>
      '<div class="branch"><a href="' + escapeHtml(branch.url) + '" target="_blank" rel="noopener">' + escapeHtml(branch.name) + "</a>" +
      '<div class="addr">' + escapeHtml(branch.address) + "</div>" +
      '<div class="score">★ ' + escapeHtml(branch.rating == null ? "—" : branch.rating) +
      " <span>" + escapeHtml(branch.reviews_count == null ? "—" : branch.reviews_count) + " отзывов</span></div></div>").join("");
    Object.keys(buttons).forEach((key) => {
      buttons[key].onclick = () => {
        range = key;
        Object.keys(buttons).forEach((other) => buttons[other].classList.toggle("active", other === key));
        render();
      };
    });
    search.oninput = render;
    branchSelect.onchange = render;
    lowOnly.onchange = render;
    render();
  </script>
</body>
</html>
`;

/** Model behind the most recent analysis, shown in the page header. */
function latestModel(reviews: Review[]): string | null {
  let best: Review["analysis"] | undefined;
  for (const review of reviews) {
    const current = review.analysis;
    if (current && (!best || current.analyzed_at > best.analyzed_at)) best = current;
  }
  return best?.model ?? null;
}

function dashboardPayload(root: string) {
  const cfg = loadConfig(root);
  const hours = cfg.lookback_hours || 24;
  const weekHours = cfg.week_hours || 168;
  const [reviews] = mergeReviews(loadExisting(root), []);
  return {
    generated_at: new Date().toISOString(),
    timezone: cfg.timezone || "Asia/Almaty",
    lookback_hours: hours,
    week_hours: weekHours,
    recent_count: lookbackReviews(reviews, hours).length,
    week_count: lookbackReviews(reviews, weekHours).length,
    total_count: reviews.length,
    llm_model: latestModel(reviews),
    branches: loadBranches(root).map(({ id, name, address, rating, reviews_count, url }) => ({
      id,
      name,
      address,
      rating,
      reviews_count,
      url,
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      branch_id: review.branch_id,
      branch_name: review.branch_name,
      branch_address: review.branch_address,
      rating: review.rating,
      author: review.author,
      text: review.text,
      url: review.url,
      published_at: review.published_at,
      likes_count: review.likes_count ?? 0,
      photos_count: review.photos_count ?? 0,
      replies_count: review.replies_count,
      replies: review.replies,
      relevant: review.analysis?.relevant ?? null,
      sentiment: review.analysis?.sentiment ?? null,
      topics: review.analysis?.topics ?? [],
      summary: review.analysis?.summary ?? "",
    })),
  };
}

export function renderHtml(root: string): string {
  // "<" is escaped so review text cannot close the inline <script>.
  const payload = JSON.stringify(dashboardPayload(root)).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__PAYLOAD__", () => payload);
}

/** Writes the self-contained dashboard to `data/index.html` and returns its path. */
export function writeHtml(root: string): string {
  const file = paths(root).indexHtml;
  writeFileSync(file, renderHtml(root), "utf8");
  return file;
}

export function openInBrowser(file: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  const child = spawn(command as string, args as string[], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
