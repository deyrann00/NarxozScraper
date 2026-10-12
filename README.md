# NarxozScraper

Мониторинг упоминаний **Университета Нархоз** в одном месте: отзывы из [2ГИС](https://2gis.kz) и посты из [Threads](https://www.threads.com) собираются в общий отчёт. LLM через [OpenRouter](https://openrouter.ai) отсеивает нерелевантное, определяет тональность и пишет общий анализ за период. Отчёт можно отправить на почту.

| Папка | Что внутри |
| --- | --- |
| `2gis/` | Скрапер отзывов 2ГИС (TypeScript, Node). Там же код общего отчёта. Бывший [Narxoz2GisScraper](https://github.com/deyrann00/Narxoz2GisScraper) |
| `threads/` | Скрапер Threads (Python + Playwright для скрипта, TypeScript для плагина). Бывший [SocNetScraper](https://github.com/deyrann00/SocNetScraper) |
| `scripts/narxoz.sh` | Одна команда для обоих скраперов и общего отчёта |
| `Dockerfile` | Образ `deyrann00/narxoz-scraper` со всем сразу |

История обоих проектов сохранена (`git log -- 2gis`, `git log -- threads`).

## Общий отчёт

`report.html` — один самодостаточный файл, сервер не нужен:

- **Общий анализ.** LLM пишет два абзаца о настроении за период и о том, чем отличаются 2ГИС и Threads.
- **Главные проблемы.** До шести проблем с числом упоминаний, источниками и ссылками на примеры. Без LLM их заменяют частые темы негативных упоминаний.
- **Цифры.** Карточки (релевантные, доля негатива, средняя оценка 2ГИС, объём по источникам) и графики: тональность по источникам, упоминания по дням, частые темы. При наведении на график появляется подсказка.
- **Все упоминания.** Фильтры по источнику и тональности, поиск, вид «лента» или «таблица». Нерелевантные скрыты, их показывает галочка.

Общий анализ кэшируется в `data/report-overview.json`: пересборка и повторная отправка того же периода не стоят запросов к LLM.

## Запуск через Docker

```bash
docker run --rm --env-file .env -v "$PWD/data:/data" deyrann00/narxoz-scraper all --email
```

| Команда | Что делает |
| --- | --- |
| `all [--email] [--hours N]` | Собрать 2ГИС и Threads, проанализировать, собрать общий отчёт (по умолчанию) |
| `report [--email] [--hours N] [--no-overview]` | Только общий отчёт из уже собранных данных |
| `2gis <команда>` | Команды 2GIS-скрапера: `run`, `analyze --force`, `email`, `help` |
| `threads <команда>` | Команды Threads-скрапера: `scrape`, `analyze --force`, `view --file` |
| `login` | Сохранить сессию Threads (браузер на виртуальном дисплее) |
| `mcp-2gis` | MCP-сервер 2ГИС на stdio, для Claude (`docker run -i`) |

Все данные лежат в одном томе `/data`:

```text
data/
├── report.html              общий отчёт
├── 2gis/config.json         настройки 2ГИС, LLM, почты и отчёта
├── 2gis/data/…              reviews.jsonl, reviews.csv, index.html, runs/
├── threads/config.json      настройки Threads
└── threads/data/…           posts.jsonl, posts.csv, index.html, media/
```

При первом запуске на пустом томе конфиги копируются из образа, дальше их можно править.

### По расписанию

```cron
# каждый день в 09:00 — оба источника и общий отчёт за сутки на почту
0 9 * * *  docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/data deyrann00/narxoz-scraper all --email --hours 24 >> /srv/narxoz/cron.log 2>&1
# по понедельникам — недельный отчёт из уже собранных данных
30 9 * * 1 docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/data deyrann00/narxoz-scraper report --email --hours 168 >> /srv/narxoz/cron.log 2>&1
```

## Запуск без Docker

Нужны Node 18+ и Python 3.11+ (для Threads):

```bash
cd threads && python -m venv .venv && .venv/bin/pip install -e . && .venv/bin/python -m playwright install chromium && cd ..
cp .env.example .env   # ключи
scripts/narxoz.sh all --email
```

`scripts/narxoz.sh` подгружает `.env` из корня и сам находит `threads/.venv`. Отчёт появится в `2gis/data/report.html`, если не задан `NARXOZ_REPORT_PATH`. Строка для crontab:

```cron
0 9 * * * /path/to/NarxozScraper/scripts/narxoz.sh all --email --hours 24 >> /path/to/NarxozScraper/cron.log 2>&1
```

## Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `OPENROUTER_API_KEY` | LLM: анализ каждого упоминания и общий анализ. Без ключа 2ГИС оценивается по звёздам, Threads остаётся без анализа, общего анализа нет |
| `SMTP_USER`, `SMTP_PASS` | Почта для отчётов. Для Gmail нужен [пароль приложения](https://myaccount.google.com/apppasswords) |
| `THREADS_ACCESS_TOKEN` | Официальный Threads API, по желанию |
| `THREADS_USERNAME`, `THREADS_PASSWORD` | Только для `login` |
| `NARXOZ_2GIS_ROOT`, `NARXOZ_SCRAPER_ROOT` | Папки данных 2ГИС и Threads (в образе — `/data/2gis`, `/data/threads`) |
| `NARXOZ_REPORT_PATH` | Куда писать общий отчёт (в образе — `/data/report.html`) |

## Настройка общего отчёта

Блок `report` в `2gis/config.json`. Модель, ключ и почта общие с 2ГИС (блоки `llm` и `email`):

| Поле | Значение |
| --- | --- |
| `period_hours` | Период отчёта по умолчанию, 168 часов (7 дней) |
| `overview` | `false` — без общего анализа LLM |
| `threads_root` | Папка Threads-скрапера. Пусто — `NARXOZ_SCRAPER_ROOT`, потом `../threads` |
| `output` | Путь к `report.html`. Пусто — `NARXOZ_REPORT_PATH`, потом `2gis/data/report.html` |
| `subject` | Тема письма, `{period}` заменяется на период |

## Плагины для Claude Code

Оба плагина ставятся из одного marketplace:

```text
/plugin marketplace add deyrann00/NarxozScraper
/plugin install narxoz-2gis@narxoz-marketplace
/plugin install narxoz-threads@narxoz-marketplace
```

В плагине 2ГИС есть инструмент `narxoz_combined_report`: «собери общий отчёт по 2ГИС и Threads и отправь на почту».

## Разработка

После правок TypeScript в `2gis/plugins/mcp/src` пересоберите бандл:

```bash
cd 2gis/plugins/mcp && npm install && npm run build
```
