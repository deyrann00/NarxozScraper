import type { Overview, Stats } from "./overview.js";
import type { Item } from "./sources.js";

export type ReportPayload = {
  generated_at: string;
  timezone: string;
  period_hours: number;
  period_label: string;
  overview: Overview;
  stats: Stats;
  threads_connected: boolean;
  items: Item[];
};

// The page script avoids template literals so this file can hold it in one.
// Sentiment is polarity, so it uses a diverging pair with a gray midpoint
// (validated for CVD in light and dark; gray always ships with labels and a table).
const TEMPLATE = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Нархоз · 2ГИС и Threads</title>
  <style>
    :root {
      color-scheme: light;
      --brand: #D50032;
      --head: #01080A;
      --ink: #0b0b0b;
      --ink-2: #52514e;
      --muted: #6b6a65;
      --line: #e6e5e1;
      --bg: #f5f5f3;
      --card: #fcfcfb;
      --raised: #ffffff;
      --neg: #e34948;
      --neu: #b8b7b0;
      --pos: #2a78d6;
      --neg-soft: #fde9e8;
      --pos-soft: #e3eefb;
      --neu-soft: #efeeea;
      --link: #1c5cab;
      --star: #c98500;
    }
    @media (prefers-color-scheme: dark) {
      :root:where(:not([data-theme="light"])) {
        color-scheme: dark;
        --ink: #f0efec; --ink-2: #c3c2b7; --muted: #9a9990; --line: #33332f;
        --bg: #121211; --card: #1a1a19; --raised: #222220;
        --neg: #e66767; --neu: #5f5e58; --pos: #3987e5;
        --neg-soft: #3a2221; --pos-soft: #1d2b3d; --neu-soft: #2a2a27;
        --link: #86b6ef; --star: #eda100;
      }
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --ink: #f0efec; --ink-2: #c3c2b7; --muted: #9a9990; --line: #33332f;
      --bg: #121211; --card: #1a1a19; --raised: #222220;
      --neg: #e66767; --neu: #5f5e58; --pos: #3987e5;
      --neg-soft: #3a2221; --pos-soft: #1d2b3d; --neu-soft: #2a2a27;
      --link: #86b6ef; --star: #eda100;
    }
    * { box-sizing: border-box; }
    body { overflow-x: hidden; margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); }
    a { color: var(--link); }
    header { background: var(--head); color: #fff; padding: 28px 16px 26px; }
    .wrap { max-width: 1080px; margin: 0 auto; }
    .kicker { color: var(--brand); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; }
    h1 { margin: 8px 0 6px; font-size: 28px; font-weight: 650; }
    .sub { color: #c9cdd3; font-size: 14px; }
    main { padding: 0 16px 48px; }
    section { margin-top: 22px; }
    h2 { font-size: 18px; margin: 0 0 10px; }
    .panel { min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
    .summary p { margin: 0 0 10px; line-height: 1.55; }
    .summary p:last-child { margin-bottom: 0; }
    .note { color: var(--muted); font-size: 14px; }
    .problems { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; }
    .problem { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; border-top: 3px solid var(--neg); }
    .problem h3 { margin: 0; font-size: 15px; display: flex; justify-content: space-between; gap: 10px; }
    .problem h3 span { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
    .problem p { margin: 6px 0 8px; color: var(--ink-2); font-size: 14px; line-height: 1.45; }
    .problem ul { margin: 0; padding-left: 18px; font-size: 13px; color: var(--ink-2); }
    .problem li { margin: 4px 0; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .chip { font-size: 12px; border-radius: 999px; padding: 2px 9px; background: var(--neu-soft); color: var(--ink-2); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: 12px; }
    .tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
    .tile .v { font-size: 28px; font-weight: 700; }
    .tile .l { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 12px; margin-top: 12px; }
    .chart h3 { margin: 0 0 10px; font-size: 14px; color: var(--ink-2); font-weight: 600; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); margin-bottom: 10px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
    .s-negative { background: var(--neg); }
    .s-neutral { background: var(--neu); }
    .s-positive { background: var(--pos); }
    .hrow { display: grid; grid-template-columns: 112px 1fr 44px; gap: 10px; align-items: center; margin: 8px 0; font-size: 13px; }
    .hrow .name { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hrow .num { color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; }
    .bar { display: flex; gap: 2px; height: 16px; }
    .bar .seg { height: 100%; min-width: 3px; }
    .bar .seg:last-child { border-radius: 0 4px 4px 0; }
    .bar.empty { background: var(--neu-soft); border-radius: 0 4px 4px 0; }
    .cols { display: flex; align-items: flex-end; gap: 4px; height: 160px; border-bottom: 1px solid var(--line); padding-top: 6px; }
    .col { flex: 1; display: flex; flex-direction: column-reverse; gap: 2px; height: 100%; justify-content: flex-start; min-width: 0; }
    .col .seg { width: 100%; }
    .col .seg:last-child { border-radius: 4px 4px 0 0; }
    .col-labels { display: flex; gap: 4px; font-size: 11px; color: var(--muted); margin-top: 4px; }
    .col-labels span { flex: 1; text-align: center; overflow: visible; white-space: nowrap; min-width: 0; display: flex; justify-content: center; }
    .hit { cursor: default; }
    #tip { position: fixed; pointer-events: none; background: var(--raised); color: var(--ink); border: 1px solid var(--line);
      border-radius: 8px; padding: 6px 9px; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.18); display: none; z-index: 10; white-space: pre; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; background: var(--card); border: 1px solid var(--line);
      border-radius: 14px; padding: 10px; }
    .seg-ctl { display: flex; background: var(--bg); border-radius: 18px; padding: 4px; flex-wrap: wrap; max-width: 100%; }
    .seg-ctl button { border: 0; background: transparent; padding: 7px 13px; border-radius: 999px; cursor: pointer; font: inherit; color: var(--ink-2); }
    .seg-ctl button.active { background: var(--brand); color: #fff; }
    .seg-ctl .count { opacity: .8; font-size: 12px; margin-left: 4px; }
    .check { display: flex; gap: 6px; align-items: center; font-size: 14px; color: var(--ink-2); cursor: pointer; }
    input[type="search"] { flex: 1; min-width: 180px; border: 1px solid var(--line); border-radius: 999px; padding: 9px 14px;
      font: inherit; background: var(--raised); color: var(--ink); }
    .stats { color: var(--muted); font-size: 13px; width: 100%; padding: 0 4px; }
    .item { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; margin: 10px 0; }
    .item.irrelevant { opacity: .6; }
    .meta { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .who { font-weight: 700; }
    .when { color: var(--muted); font-size: 13px; }
    .place { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .badge { font-size: 12px; border-radius: 999px; padding: 3px 10px; background: var(--neu-soft); color: var(--ink-2); }
    .badge.src { font-weight: 700; }
    .badge.negative { background: var(--neg-soft); color: var(--ink); box-shadow: inset 3px 0 0 var(--neg); }
    .badge.neutral { background: var(--neu-soft); color: var(--ink); box-shadow: inset 3px 0 0 var(--neu); }
    .badge.positive { background: var(--pos-soft); color: var(--ink); box-shadow: inset 3px 0 0 var(--pos); }
    .stars { color: var(--star); letter-spacing: 1px; }
    .gist { color: var(--ink-2); font-style: italic; font-size: 14px; margin-top: 8px; }
    .quote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); font-size: 13px; margin-top: 8px; white-space: pre-wrap; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; margin-top: 8px; }
    .foot { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 13px; margin-top: 8px; }
    .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow-x: auto; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--ink-2); font-weight: 600; font-size: 12px; white-space: nowrap; }
    td.nw { white-space: nowrap; }
    tr.row-negative td:first-child { box-shadow: inset 3px 0 0 var(--neg); }
    tr.row-neutral td:first-child { box-shadow: inset 3px 0 0 var(--neu); }
    tr.row-positive td:first-child { box-shadow: inset 3px 0 0 var(--pos); }
    tr.row-irrelevant { color: var(--muted); }
    .empty { text-align: center; padding: 40px 16px; color: var(--muted); }
    @media (max-width: 560px) { .hrow { grid-template-columns: 84px 1fr 36px; } h1 { font-size: 23px; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="kicker">NarxozScraper</div>
      <h1>Нархоз · 2ГИС и Threads</h1>
      <div class="sub" id="generated"></div>
    </div>
  </header>
  <main class="wrap">
    <section>
      <h2>Общий анализ</h2>
      <div class="panel summary" id="summary"></div>
    </section>
    <section>
      <h2>Главные проблемы</h2>
      <div class="problems" id="problems"></div>
    </section>
    <section>
      <h2>Цифры за период</h2>
      <div class="tiles" id="tiles"></div>
      <div class="charts">
        <div class="panel chart"><h3>Тональность по источникам</h3><div class="legend" data-legend></div><div id="bySource"></div></div>
        <div class="panel chart"><h3 id="timelineTitle">Релевантные упоминания по дням</h3><div class="legend" data-legend></div><div id="timeline"></div></div>
        <div class="panel chart"><h3>Частые темы</h3><div class="legend" data-legend></div><div id="topics"></div></div>
      </div>
    </section>
    <section>
      <h2>Все упоминания</h2>
      <div class="toolbar">
        <div class="seg-ctl" id="sources">
          <button data-v="" class="active" type="button">Все</button>
          <button data-v="2gis" type="button">2ГИС<span class="count"></span></button>
          <button data-v="threads" type="button">Threads<span class="count"></span></button>
        </div>
        <div class="seg-ctl" id="sentiments">
          <button data-v="" class="active" type="button">Любая</button>
          <button data-v="negative" type="button">Негатив<span class="count"></span></button>
          <button data-v="neutral" type="button">Нейтрально<span class="count"></span></button>
          <button data-v="positive" type="button">Позитив<span class="count"></span></button>
        </div>
        <div class="seg-ctl" id="views">
          <button data-v="feed" class="active" type="button">Лента</button>
          <button data-v="table" type="button">Таблица</button>
        </div>
        <label class="check"><input id="irrelevant" type="checkbox"> показать нерелевантные</label>
        <input id="q" type="search" placeholder="Поиск по тексту, автору, темам">
        <div class="stats" id="stats"></div>
      </div>
      <div id="feed"></div>
    </section>
  </main>
  <div id="tip" role="tooltip"></div>
  <script>
    const DATA = __PAYLOAD__;
    const LABEL = { negative: "Негатив", neutral: "Нейтрально", positive: "Позитив" };
    const SOURCE = { "2gis": "2ГИС", threads: "Threads" };
    const ORDER = ["negative", "neutral", "positive"];
    const state = { source: "", sentiment: "", view: "feed" };

    function esc(text) {
      return String(text == null ? "" : text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }
    function when(value) {
      const dt = value ? new Date(value) : null;
      if (!dt || Number.isNaN(dt.getTime())) return "";
      return dt.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: DATA.timezone });
    }
    function pct(part, total) { return total ? Math.round(part * 100 / total) + "%" : "—"; }
    function sum(c) { return c.negative + c.neutral + c.positive; }
    function tipText(title, c) {
      return title + "\\n" + ORDER.map(function (k) { return LABEL[k] + ": " + c[k]; }).join("\\n");
    }

    // Header and LLM overview
    document.getElementById("generated").textContent =
      "Период: " + DATA.period_label + " · обновлено " + when(DATA.generated_at) +
      (DATA.overview.model ? " · анализ: " + DATA.overview.model : "") +
      (DATA.threads_connected ? "" : " · данные Threads не найдены");
    const ov = DATA.overview;
    document.getElementById("summary").innerHTML = ov.summary
      ? ov.summary.split(/\\n\\s*\\n/).map(function (p) { return "<p>" + esc(p.trim()) + "</p>"; }).join("")
      : '<p class="note">' + esc(ov.note || "Нет сводки.") + "</p>";
    const byId = {};
    DATA.items.forEach(function (item) { byId[item.id] = item; });
    document.getElementById("problems").innerHTML = ov.problems.length
      ? ov.problems.map(function (p) {
          const examples = p.example_ids.map(function (id) { return byId[id]; }).filter(Boolean).map(function (item) {
            return '<li><a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(SOURCE[item.source]) + "</a> — " +
              esc((item.summary || item.text).slice(0, 140)) + "</li>";
          }).join("");
          return '<div class="problem"><h3>' + esc(p.title) + "<span>" + p.count + " упом.</span></h3>" +
            (p.description ? "<p>" + esc(p.description) + "</p>" : "") +
            (examples ? "<ul>" + examples + "</ul>" : "") +
            '<div class="chips">' + p.sources.map(function (s) { return '<span class="chip">' + esc(SOURCE[s]) + "</span>"; }).join("") + "</div></div>";
        }).join("")
      : '<div class="panel note">Негативных упоминаний за период нет.</div>';

    // Numbers
    const st = DATA.stats;
    const tiles = [
      [st.relevant, "релевантных упоминаний"],
      [pct(st.sentiment.negative, st.relevant), "негативных (" + st.sentiment.negative + ")"],
      [st.avg_rating_2gis == null ? "—" : "★ " + st.avg_rating_2gis, "средняя оценка в 2ГИС"],
      [st.by_source["2gis"].total + " / " + st.by_source.threads.total, "отзывов 2ГИС / постов Threads"],
    ];
    document.getElementById("tiles").innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="v">' + esc(t[0]) + '</div><div class="l">' + esc(t[1]) + "</div></div>";
    }).join("");
    document.querySelectorAll("[data-legend]").forEach(function (el) {
      el.innerHTML = ORDER.map(function (k) { return '<span><i class="s-' + k + '"></i>' + LABEL[k] + "</span>"; }).join("");
    });
    function hbar(name, c, scaleTotal) {
      const total = sum(c);
      const width = scaleTotal ? Math.max(total / scaleTotal * 100, total ? 2 : 0) : 100;
      const segs = ORDER.filter(function (k) { return c[k]; }).map(function (k) {
        return '<div class="seg s-' + k + '" style="flex:' + c[k] + '"></div>';
      }).join("");
      return '<div class="hrow hit" data-tip="' + esc(tipText(name, c)) + '"><div class="name" title="' + esc(name) + '">' + esc(name) + "</div>" +
        '<div><div class="bar' + (total ? "" : " empty") + '" style="width:' + width + '%">' + segs + "</div></div>" +
        '<div class="num">' + total + "</div></div>";
    }
    document.getElementById("bySource").innerHTML = ["2gis", "threads"].map(function (s) {
      return hbar(SOURCE[s], st.by_source[s], 0);
    }).join("") + '<div class="note" style="margin-top:8px">Доли внутри источника; справа — число релевантных.</div>';
    const peak = Math.max.apply(null, st.timeline.map(function (b) { return sum(b.counts); }).concat([1]));
    if (st.timeline.length && st.timeline[0].unit === "week") document.getElementById("timelineTitle").textContent = "Релевантные упоминания по неделям";
    const every = Math.ceil(st.timeline.length / 6);
    document.getElementById("timeline").innerHTML = st.timeline.length
      ? '<div class="cols">' + st.timeline.map(function (b) {
          const segs = ORDER.filter(function (k) { return b.counts[k]; }).map(function (k) {
            return '<div class="seg s-' + k + '" style="height:' + (b.counts[k] / peak * 100) + '%"></div>';
          }).join("");
          return '<div class="col hit" data-tip="' + esc(tipText(b.label, b.counts)) + '">' + segs + "</div>";
        }).join("") + '</div><div class="col-labels">' + st.timeline.map(function (b, i) {
          return "<span>" + (i % every === 0 ? esc(b.label.slice(5)) : "") + "</span>";
        }).join("") + "</div>"
      : '<div class="note">Нет данных.</div>';
    const topMax = Math.max.apply(null, st.topics.map(function (t) { return t.total; }).concat([1]));
    document.getElementById("topics").innerHTML = st.topics.length
      ? st.topics.map(function (t) { return hbar(t.topic, t.counts, topMax); }).join("")
      : '<div class="note">Темы появятся после LLM-анализа.</div>';

    // Hover layer: one tooltip for every mark carrying data-tip
    const tip = document.getElementById("tip");
    document.addEventListener("mousemove", function (e) {
      const hit = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!hit) { tip.style.display = "none"; return; }
      tip.textContent = hit.getAttribute("data-tip");
      tip.style.display = "block";
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + "px";
      tip.style.top = (e.clientY + 14) + "px";
    });

    // Mentions
    const feed = document.getElementById("feed");
    const stats = document.getElementById("stats");
    const search = document.getElementById("q");
    const showIrrelevant = document.getElementById("irrelevant");
    function stars(r) { return r ? '<span class="stars" title="' + r + ' из 5">' + "★".repeat(r) + "☆".repeat(5 - r) + "</span>" : ""; }
    function badges(item) {
      const head = item.relevant === false ? '<span class="badge">Нерелевантный</span>'
        : item.sentiment ? '<span class="badge ' + item.sentiment + '">' + LABEL[item.sentiment] + "</span>"
        : '<span class="badge">Без анализа</span>';
      return '<div class="badges"><span class="badge src">' + SOURCE[item.source] + "</span>" + head +
        item.topics.map(function (t) { return '<span class="badge">' + esc(t) + "</span>"; }).join("") + "</div>";
    }
    function card(item) {
      return '<article class="item' + (item.relevant === false ? " irrelevant" : "") + '">' +
        '<div class="meta"><div class="who">' + esc(item.author || "Без имени") + " " + stars(item.rating) + "</div>" +
        '<div class="when">' + esc(when(item.published_at)) + "</div></div>" +
        '<div class="place">' + esc(item.place) + "</div>" + badges(item) +
        (item.summary ? '<div class="gist">' + esc(item.summary) + "</div>" : "") +
        (item.reply_to ? '<div class="quote">' + esc(item.reply_to.slice(0, 400)) + "</div>" : "") +
        '<div class="text">' + esc(item.text) + "</div>" +
        '<div class="foot">' + (item.source === "2gis" ? "<span>" + (item.org_answered ? "✓ есть ответ Нархоза" : "без ответа Нархоза") + "</span>" : "") +
        '<a href="' + esc(item.url) + '" target="_blank" rel="noopener">Открыть в ' + SOURCE[item.source] + "</a></div></article>";
    }
    function table(items) {
      return '<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Источник</th><th>Автор / место</th><th>★</th>' +
        "<th>Тональность</th><th>Темы</th><th>Суть / текст</th><th></th></tr></thead><tbody>" +
        items.map(function (item) {
          const kind = item.relevant === false ? "irrelevant" : (item.sentiment || "");
          const label = item.relevant === false ? "Нерелевантный" : (LABEL[item.sentiment] || "—");
          return '<tr class="row-' + kind + '"><td class="nw">' + esc(when(item.published_at)) + "</td><td>" + SOURCE[item.source] + "</td>" +
            "<td>" + esc(item.author) + "<br><span class=\\"when\\">" + esc(item.place) + "</span></td><td>" + (item.rating || "—") + "</td>" +
            "<td>" + label + "</td><td>" + esc(item.topics.join(", ")) + "</td>" +
            "<td>" + esc(item.summary || item.text.slice(0, 220)) + "</td>" +
            '<td><a href="' + esc(item.url) + '" target="_blank" rel="noopener">открыть</a></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    function render() {
      const needle = search.value.trim().toLowerCase();
      const base = DATA.items.filter(function (item) {
        if (!showIrrelevant.checked && item.relevant === false) return false;
        if (!needle) return true;
        return [item.author, item.place, item.text, item.summary, item.topics.join(" "), item.reply_to].join(" ").toLowerCase().includes(needle);
      });
      document.querySelectorAll("#sources button").forEach(function (b) {
        const c = b.querySelector(".count");
        if (c) c.textContent = base.filter(function (i) { return i.source === b.dataset.v; }).length;
      });
      const bySource = base.filter(function (i) { return !state.source || i.source === state.source; });
      document.querySelectorAll("#sentiments button").forEach(function (b) {
        const c = b.querySelector(".count");
        if (c) c.textContent = bySource.filter(function (i) { return i.relevant !== false && i.sentiment === b.dataset.v; }).length;
      });
      const items = bySource.filter(function (i) { return !state.sentiment || (i.relevant !== false && i.sentiment === state.sentiment); });
      stats.textContent = "Показано: " + items.length + " из " + DATA.items.length + " за период";
      if (!items.length) { feed.innerHTML = '<div class="empty">Ничего не найдено — смените фильтры.</div>'; return; }
      feed.innerHTML = state.view === "table" ? table(items) : items.map(card).join("");
    }
    function segment(id, key) {
      document.querySelectorAll("#" + id + " button").forEach(function (button) {
        button.onclick = function () {
          state[key] = button.dataset.v;
          document.querySelectorAll("#" + id + " button").forEach(function (b) { b.classList.toggle("active", b === button); });
          render();
        };
      });
    }
    segment("sources", "source");
    segment("sentiments", "sentiment");
    segment("views", "view");
    search.oninput = render;
    showIrrelevant.onchange = render;
    render();
  </script>
</body>
</html>
`;

export function renderReport(payload: ReportPayload): string {
  // "<" is escaped so mention text cannot close the inline <script>.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__PAYLOAD__", () => json);
}
