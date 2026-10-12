# Narxoz2GisScraper

Сборщик отзывов из [2ГИС](https://2gis.kz) по филиалам **Университета Нархоз**, оформленный как плагин Claude Code. Устроен по той же схеме, что и [SocNetScraper](https://github.com/ardakshalkar/SocNetScraper) для Threads: MCP-сервер на TypeScript, слэш-команды, архив в JSONL/CSV.

В отличие от Threads, здесь не нужны ни браузер, ни логин: плагин читает страницы поиска 2ГИС и публичный API отзывов обычными HTTP-запросами. Единственное требование — Node 18+.

## Установка плагина

Из локальной папки:

```text
/plugin marketplace add /Users/d1rannn/Documents/Narxoz2GisScraper
/plugin install narxoz-2gis@narxoz-2gis-marketplace
```

После публикации на GitHub вместо пути подставляется `владелец/репозиторий`.

## Команды

| Команда | Что делает |
| --- | --- |
| `/narxoz-2gis:scrape` | Собирает новые отзывы и пересказывает последние 7 дней |
| `/narxoz-2gis:report` | Пересказывает сохранённый архив, без нового сбора |
| `/narxoz-2gis:view` | Открывает HTML-страницу с отзывами и ответами в браузере |
| `/narxoz-2gis:setup` | Проверяет установку и показывает, какие филиалы отслеживаются |
| `/narxoz-2gis:email` | Отправляет отчёт на почту (только по запросу) |

Можно и просто попросить словами: «собери отзывы о Нархозе в 2ГИС».

## Как это работает

1. **Поиск филиалов.** Для каждой фразы из `queries` открывается `https://2gis.kz/<city>/search/<фраза>`; карточки организаций берутся из состояния страницы (`initialState`). Остаются те, в названии которых есть слово из `name_filters`, плюс остальные филиалы тех же организаций (например, общежитие с другим названием).
2. **Отзывы.** По каждому филиалу запрашивается `public-api.reviews.2gis.com`, от новых к старым. Обычный запуск читает до начала недельного окна, запуск с `full: true` — до `max_reviews_per_branch`.
3. **Архив.** Отзывы склеиваются с уже сохранёнными по `id`, так что повторные запуски не создают дублей.
4. **Анализ.** Новые и отредактированные отзывы пачками уходят в LLM через OpenRouter. Модель решает, релевантен ли отзыв для администрации (спам, пустые «ок», реклама и отзывы не о Нархозе отсеиваются), определяет тональность (позитив / нейтрально / негатив), темы и суть одной фразой. Результат хранится в поле `analysis` у отзыва, поэтому повторно отзыв не отправляется. Без ключа тональность берётся по звёздам (4–5 — позитив, 3 — нейтрально, 1–2 — негатив), и ничего не отсеивается.

## Где лежат данные

При запуске внутри этого репозитория — в его папке `data/`, при отдельной установке — в `~/.narxoz-2gis`. Переменная `NARXOZ_2GIS_ROOT` переопределяет оба варианта.

- `data/reviews.jsonl` — полный архив, по одному отзыву в строке; у каждого отзыва есть `replies_count` и `replies` — вся ветка ответов (и от Нархоза, `from_org: true`, и от пользователей)
- `data/reviews.csv` — то же для таблиц
- `data/branches.json` — последний найденный список филиалов с рейтингом
- `data/index.html` — HTML-страница с отзывами и ответами: фильтры по периоду (24 часа / 7 дней / все), тональности, филиалу, оценке и поиск, сводная таблица «филиал × тональность», вид «Лента» или «Таблица». Нерелевантные скрыты, их показывает отдельная галочка. Пересобирается при каждом сборе, открывается двойным кликом — сервер не нужен
- `data/runs/` — по одному JSON на каждый запуск

## Настройка (`config.json`)

| Поле | Значение |
| --- | --- |
| `queries` | Поисковые фразы в 2ГИС |
| `name_filters` | Слова, по которым филиал считается «своим» |
| `branches` | id филиалов или ссылки на карточки, которые отслеживаются всегда |
| `exclude_branches` | id или ссылки, которые нужно исключить |
| `city`, `domain`, `locale` | Город и домен 2ГИС (`almaty`, `2gis.kz`, `ru_KZ`) |
| `lookback_hours`, `week_hours` | Окна «сутки» и «неделя» для сводки |
| `max_reviews_per_branch` | Предел отзывов на филиал за один запуск |
| `review_api_key` | Свой ключ API отзывов; пусто — берётся со страницы 2ГИС |

Чтобы следить за другой организацией, достаточно поменять `queries` и `name_filters`.

## LLM через OpenRouter

1. Получите ключ на [openrouter.ai/keys](https://openrouter.ai/keys) и задайте его в окружении до запуска Claude:
   ```bash
   export OPENROUTER_API_KEY=sk-or-...
   ```
2. Модель выбирается в `config.json` → `llm.model`: любой slug OpenRouter, например `openai/gpt-4o-mini`, `google/gemini-2.5-flash`, `anthropic/claude-haiku-4.5`.
3. После смены модели или промпта переклассифицируйте архив: «перепроверь отзывы» или `analyze_narxoz_2gis` с `force: true`.

| Поле `llm` | Значение |
| --- | --- |
| `enabled` | `false` — не вызывать LLM, только оценка по звёздам |
| `base_url` | Любой OpenAI-совместимый endpoint (по умолчанию OpenRouter) |
| `model` | Модель |
| `api_key_env` | Имя переменной окружения с ключом (сам ключ в конфиг не пишется) |
| `batch_size` | Отзывов в одном запросе (по умолчанию 20) |
| `temperature` | Температура (по умолчанию 0) |
| `relevance_prompt` | Своё описание того, что важно администрации; пусто — встроенное |

## Отправка на email

Письмо содержит сводную таблицу по филиалам и три таблицы (негативные, нейтральные, позитивные) с сутью каждого отзыва и ссылкой на 2ГИС. Интерактивный `index.html` приходит вложением. Нерелевантные в письмо не попадают. Письмо отправляется только по запросу: `/narxoz-2gis:email` или «отправь отчёт на почту».

1. В `config.json` → `email.to` перечислите получателей.
2. Задайте SMTP-логин и пароль в окружении. Для Gmail нужен [пароль приложения](https://myaccount.google.com/apppasswords), обычный пароль не подойдёт:
   ```bash
   export SMTP_USER=you@gmail.com
   export SMTP_PASS=<пароль-приложения>
   ```
3. Для другой почты поменяйте `smtp_host` / `smtp_port` / `smtp_secure` (например, `smtp.yandex.ru`, 465, `true`). `from` пустой — письмо уходит от `SMTP_USER`. `period_hours` — окно отчёта (по умолчанию 168 часов, то есть 7 дней). В `subject` подставляется `{period}`.

## Docker

```bash
docker run -i --rm \
  --env-file .env \
  -v "$PWD/data:/app/data" -v "$PWD/config.json:/app/config.json" \
  deyrann00/narxoz-2gis-scraper
```

## Запуск по расписанию (cron)

Тот же сервер работает как одноразовая команда: с аргументом он выполняет задачу и завершается, без аргументов запускается MCP-сервер.

```bash
node plugins/claude/server/index.js run                       # сбор + LLM-анализ + index.html
node plugins/claude/server/index.js run --email --hours 24    # то же и отчёт за сутки на почту
node plugins/claude/server/index.js analyze --force           # переклассифицировать архив
node plugins/claude/server/index.js email --to a@b.kz,c@d.kz  # только письмо
node plugins/claude/server/index.js help
```

Для cron удобнее обёртка `scripts/cron.sh`. Она:
- подгружает `.env` из корня репозитория;
- находит `node` (Homebrew, `/usr/local`), путь можно задать через `NODE=`;
- не запускает второй сбор, пока идёт первый;
- дописывает вывод в `logs/cron-ГГГГ-ММ.log`.

Код выхода: `0` — успех, `1` — сбор или письмо не удались.

`crontab -e`:

```cron
# каждый день в 09:00 — сбор и отчёт за сутки
0 9 * * *  /path/to/Narxoz2GisScraper/scripts/cron.sh run --email --hours 24
# по понедельникам в 09:30 — недельный отчёт
30 9 * * 1 /path/to/Narxoz2GisScraper/scripts/cron.sh email --hours 168
```

На macOS cron по умолчанию не может читать `~/Documents`. Дайте `/usr/sbin/cron` полный доступ к диску (Системные настройки → Конфиденциальность и безопасность → Доступ к диску) или держите репозиторий вне `~/Documents`.

Через Docker аргументы передаются после имени образа (`-i` не нужен):

```cron
0 9 * * * docker run --rm --env-file /srv/narxoz/.env -v /srv/narxoz/data:/app/data -v /srv/narxoz/config.json:/app/config.json deyrann00/narxoz-2gis-scraper run --email --hours 24 >> /srv/narxoz/cron.log 2>&1
```

## Инструменты MCP

- `scrape_narxoz_2gis` — сбор (`full: true` — добрать старые отзывы)
- `latest_narxoz_2gis` — чтение архива (`hours`, `limit`, `max_rating`, `sentiment`, `include_irrelevant`)
- `view_narxoz_2gis` — пересобрать `data/index.html` и открыть в браузере (`open: false` — только пересобрать)
- `analyze_narxoz_2gis` — классификация LLM (`force: true` — заново, `hours` — только за окно)
- `send_narxoz_2gis_report` — отправка отчёта на почту (`to`, `hours`)
- `find_narxoz_2gis_branches` — какие филиалы будут собираться
- `narxoz_2gis_status` — пути, филиалы, последний запуск
- `narxoz_2gis_data_path` — путь к `reviews.jsonl`

## Разработка

Нужна только при изменении TypeScript в `plugins/mcp/src`:

```bash
cd plugins/mcp && npm install && npm run build
```

Сборка кладёт готовый `server/index.js` в `plugins/claude` — именно этот файл запускает плагин, поэтому его нужно хранить в репозитории.
