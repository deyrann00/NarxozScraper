# Narxoz 2GIS Scraper

Скрипт, который собирает отзывы из [2ГИС](https://2gis.kz) по филиалам **Университета Нархоз**. Нерелевантные отзывы он отсеивает с помощью LLM (через [OpenRouter](https://openrouter.ai)), остальные раскладывает на **позитивные / нейтральные / негативные**, строит HTML-отчёт и может отправить его на email. Запускается одной командой вручную или по cron. Тот же образ подключается к Claude Code как плагин.

Исходники: [github.com/deyrann00/Narxoz2GisScraper](https://github.com/deyrann00/Narxoz2GisScraper)

## Возможности

- Сбор отзывов и ответов организации по всем филиалам: обычные HTTP-запросы, без браузера и логина
- LLM-анализ каждого отзыва: релевантен ли он администрации, тональность, темы, суть одной фразой. Отзыв анализируется один раз, результат хранится в архиве
- Один самодостаточный `index.html`: фильтры по периоду, тональности и филиалу, сводная таблица «филиал × тональность», вид «лента» или «таблица»
- Отчёт на почту по SMTP: таблицы негативных, нейтральных и позитивных отзывов, интерактивный отчёт во вложении
- Архив в JSONL и CSV

## Запуск как скрипт

Каждая команда выполняет одну задачу и завершается:

```bash
docker run --rm --env-file .env \
  -v "$PWD/data:/app/data" \
  -v "$PWD/config.json:/app/config.json" \
  deyrann00/narxoz-2gis-scraper run
```

| Команда | Что делает |
| --- | --- |
| `run` | Собрать новые отзывы, проанализировать LLM, пересобрать `data/index.html` |
| `run --email --hours 24` | То же и отправить отчёт за последние 24 часа на почту |
| `run --full` | Дозагрузить старые отзывы (до `max_reviews_per_branch` на филиал) |
| `analyze [--force] [--hours N]` | Только анализ сохранённых отзывов, `--force` — заново |
| `email [--to a@b,c@d] [--hours N]` | Только отправить отчёт |
| `help` | Справка |

Код выхода: `0` — успех, `1` — сбор или письмо не удались. JSON-сводка запуска печатается в stdout и сохраняется в `data/runs/`.

### По расписанию (cron)

```cron
# каждый день в 09:00 — сбор и отчёт за сутки
0 9 * * *  docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/app/data -v /srv/narxoz/config.json:/app/config.json deyrann00/narxoz-2gis-scraper run --email --hours 24 >> /srv/narxoz/cron.log 2>&1
# по понедельникам в 09:30 — недельный отчёт
30 9 * * 1 docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/app/data -v /srv/narxoz/config.json:/app/config.json deyrann00/narxoz-2gis-scraper email --hours 168 >> /srv/narxoz/cron.log 2>&1
```

Без Docker в репозитории есть обёртка `scripts/cron.sh`. Она подгружает `.env`, не запускает второй сбор, пока идёт первый, и пишет лог в `logs/`.

## Переменные окружения

| Переменная | Назначение | Обязательна |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Ключ [OpenRouter](https://openrouter.ai/keys) для LLM-анализа | Нет. Без него тональность определяется по звёздам, и ничего не отсеивается |
| `SMTP_USER` | Логин SMTP (адрес отправителя) | Только для отправки email |
| `SMTP_PASS` | Пароль SMTP. Для Gmail это [пароль приложения](https://myaccount.google.com/apppasswords) | Только для отправки email |
| `NARXOZ_2GIS_ROOT` | Папка с `config.json` и `data/` | Нет, по умолчанию `/app` |

Пример `.env`:

```env
OPENROUTER_API_KEY=sk-or-...
SMTP_USER=you@gmail.com
SMTP_PASS=app-password
```

> Не публикуйте `.env` и не вшивайте ключи в образ: передавайте их только при запуске.

## Конфигурация (`config.json`)

Монтируется в `/app/config.json`. Если файла нет, используется конфиг из образа.

```json
{
  "queries": ["Нархоз", "Narxoz"],
  "name_filters": ["нархоз", "narxoz"],
  "city": "almaty",
  "llm": {
    "model": "openai/gpt-4o-mini",
    "base_url": "https://openrouter.ai/api/v1"
  },
  "email": {
    "to": ["admin@example.com"],
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 465,
    "smtp_secure": true,
    "period_hours": 168
  }
}
```

`llm.model` принимает любой slug OpenRouter (`google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`, …). `llm.base_url` подходит любой OpenAI-совместимый.

## Данные (`/app/data`)

| Файл | Содержимое |
| --- | --- |
| `reviews.jsonl` | Полный архив отзывов с полем `analysis` |
| `reviews.csv` | То же для таблиц, с колонками `relevant`, `sentiment`, `topics`, `summary` |
| `index.html` | Интерактивный отчёт, открывается двойным кликом |
| `branches.json` | Найденные филиалы с рейтингом |
| `runs/` | JSON-сводка каждого запуска |

## Плагин для Claude Code

Без аргументов контейнер запускается как MCP-сервер на stdin/stdout. Тогда Claude сам собирает отзывы, пересказывает их и отправляет отчёт по просьбе вроде «собери отзывы о Нархозе в 2ГИС».

**Вариант 1 — плагин из GitHub (нужен Node 18+, Docker не нужен):**

```text
/plugin marketplace add deyrann00/Narxoz2GisScraper
/plugin install narxoz-2gis@narxoz-2gis-marketplace
```

Команды: `/narxoz-2gis:scrape`, `/narxoz-2gis:report`, `/narxoz-2gis:view`, `/narxoz-2gis:email`, `/narxoz-2gis:setup`.

**Вариант 2 — MCP-сервер из этого образа** (`.mcp.json`, флаг `-i` обязателен):

```json
{
  "mcpServers": {
    "narxoz-2gis": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "/abs/path/.env",
               "-v", "/abs/path/data:/app/data",
               "-v", "/abs/path/config.json:/app/config.json",
               "deyrann00/narxoz-2gis-scraper"]
    }
  }
}
```

| MCP-инструмент | Что делает |
| --- | --- |
| `scrape_narxoz_2gis` | Собрать новые отзывы и проанализировать их (`full: true` — дозагрузить архив) |
| `analyze_narxoz_2gis` | Классифицировать отзывы LLM (`force: true` — заново) |
| `latest_narxoz_2gis` | Отзывы из архива (`hours`, `sentiment`, `include_irrelevant`, …) |
| `send_narxoz_2gis_report` | Отправить отчёт на email (`to`, `hours`) |
| `view_narxoz_2gis` | Пересобрать `index.html` |
| `find_narxoz_2gis_branches` | Список отслеживаемых филиалов |
| `narxoz_2gis_status` | Пути, настройки LLM/SMTP (без секретов), последний запуск |

## Теги

- `latest` — последняя версия
- `0.4.1` — режим скрипта для cron (`run`, `analyze`, `email`)
- `0.4.0` — LLM-анализ, разбивка по тональности, email

Платформы: `linux/amd64`, `linux/arm64`.
