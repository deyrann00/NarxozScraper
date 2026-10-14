# Narxoz Scraper

Скрипт, который следит за упоминаниями **Университета Нархоз** в двух источниках сразу — отзывы [2ГИС](https://2gis.kz) и посты [Threads](https://www.threads.com) — и собирает их в **один HTML-отчёт**. LLM через [OpenRouter](https://openrouter.ai) отсеивает нерелевантное, определяет тональность и пишет общий анализ за период. Отчёт уходит на email. Запускается одной командой вручную или по cron. Внутри также есть плагины для Claude Code.

Исходники: [github.com/deyrann00/NarxozScraper](https://github.com/deyrann00/NarxozScraper)

## Что в отчёте

- **Общий анализ:** два абзаца от LLM — настроение за период, чем отличаются 2ГИС и Threads
- **Главные проблемы:** до 6 проблем с числом упоминаний, источниками и ссылками на примеры
- **Цифры и графики:** релевантные упоминания, доля негатива, средняя оценка 2ГИС, тональность по источникам, упоминания по дням, частые темы
- **Все упоминания:** фильтры по источнику и тональности, поиск, лента или таблица. Нерелевантные скрыты галочкой
- **Фото из Threads:** превью до 4 фото прямо в карточке поста, клик открывает пост
- **Новые и уже показанные:** отчёт помнит, что уже уходило в прошлых письмах. Фильтр «Новые / Ранее показанные», бейдж «Показано 7 окт.»

`report.html` — один самодостаточный файл, открывается двойным кликом. В письме — статичная версия (анализ, проблемы, таблицы, только новые негативные упоминания), полный отчёт во вложении. Отправленные упоминания записываются в `2gis/data/report-sent.json`.

## Запуск как скрипт

```bash
docker run --rm --env-file .env -v "$PWD/data:/data" deyrann00/narxoz-scraper all --email
```

| Команда | Что делает |
| --- | --- |
| `all [--email] [--hours N]` | Собрать 2ГИС и Threads, проанализировать, собрать общий отчёт (по умолчанию) |
| `report [--email] [--hours N] [--no-overview]` | Только общий отчёт из уже собранных данных |
| `2gis <команда>` | 2ГИС отдельно: `run`, `run --full`, `analyze --force`, `email`, `help` |
| `threads <команда>` | Threads отдельно: `scrape`, `analyze --force`, `view --file` |
| `login` | Один раз войти в Threads и сохранить сессию в `/data/threads/data/` |
| `help` | Справка |

`all` завершается с кодом `1`, если хоть один шаг не удался; остальные шаги при этом всё равно выполняются.

### По расписанию (cron)

```cron
# каждый день в 09:00 — оба источника и отчёт за сутки на почту
0 9 * * *  docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/data deyrann00/narxoz-scraper all --email --hours 24 >> /srv/narxoz/cron.log 2>&1
# по понедельникам в 09:30 — недельный отчёт из уже собранных данных
30 9 * * 1 docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/data deyrann00/narxoz-scraper report --email --hours 168 >> /srv/narxoz/cron.log 2>&1
```

### Вход в Threads

Без входа Threads часто показывает стену логина. Один раз сохраните сессию (нужны `THREADS_USERNAME` / `THREADS_PASSWORD` в `.env`):

```bash
docker run --rm --env-file .env -v "$PWD/data:/data" deyrann00/narxoz-scraper login
```

## Переменные окружения

| Переменная | Назначение | Обязательна |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Ключ [OpenRouter](https://openrouter.ai/keys): анализ упоминаний и общий анализ | Нет. Без него 2ГИС оценивается по звёздам, Threads и общий анализ — без LLM |
| `SMTP_USER` | Логин SMTP (адрес отправителя) | Для email |
| `SMTP_PASS` | Пароль SMTP. Для Gmail — [пароль приложения](https://myaccount.google.com/apppasswords) | Для email |
| `THREADS_ACCESS_TOKEN` | [Официальный Threads API](https://developers.facebook.com/docs/threads/keyword-search/) | Нет, иначе браузерный поиск |
| `THREADS_USERNAME`, `THREADS_PASSWORD` | Логин Instagram / Threads | Только для `login` |

```env
OPENROUTER_API_KEY=sk-or-...
SMTP_USER=you@gmail.com
SMTP_PASS=app-password
THREADS_USERNAME=
THREADS_PASSWORD=
```

> Не публикуйте `.env` и не вшивайте ключи в образ: передавайте их только при запуске.

## Данные и настройки (`/data`)

```text
/data
├── report.html              общий отчёт
├── 2gis/config.json         2ГИС: филиалы, LLM, почта, общий отчёт
├── 2gis/data/               reviews.jsonl, reviews.csv, index.html, report-overview.json, report-sent.json, runs/
├── threads/config.json      Threads: ключевые слова, хэштеги, LLM
└── threads/data/            posts.jsonl, posts.csv, index.html, media/ (фото и превью), storage_state.json
```

При первом запуске на пустом томе оба `config.json` копируются из образа — дальше их можно править. Главное в `2gis/config.json`:

```json
{
  "llm": { "model": "openai/gpt-4o-mini", "base_url": "https://openrouter.ai/api/v1" },
  "email": { "to": ["admin@example.com"], "smtp_host": "smtp.gmail.com", "smtp_port": 465, "smtp_secure": true },
  "report": { "period_hours": 168, "overview": true, "subject": "Нархоз · 2ГИС и Threads за {period}" }
}
```

`llm.model` — любой slug OpenRouter (`google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`, …); модель для Threads задаётся в `threads/config.json` → `llm.model`.

## Плагины для Claude Code

В репозитории два плагина — 2ГИС и Threads — в одном marketplace:

```text
/plugin marketplace add deyrann00/NarxozScraper
/plugin install narxoz-2gis@narxoz-marketplace
/plugin install narxoz-threads@narxoz-marketplace
```

После этого достаточно попросить: «собери общий отчёт по 2ГИС и Threads и отправь на почту» (инструмент `narxoz_combined_report`). MCP-сервер 2ГИС можно запустить и из этого образа: `docker run -i --rm -v "$PWD/data:/data" deyrann00/narxoz-scraper mcp-2gis`.

## Теги

- `latest`, `1.1.0` — превью фото Threads в отчёте, учёт уже отправленных упоминаний и фильтр «Новые / Ранее показанные»
- `1.0.0` — общий образ: 2ГИС + Threads, общий отчёт с анализом LLM и графиками, email

Платформы: `linux/amd64`, `linux/arm64`.
