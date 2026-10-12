# Narxoz Threads Scraper (SocNetScraper)

Скрипт, который собирает публичные посты [Threads](https://www.threads.com) с упоминаниями **Нархоза** (`нархоз`, `narxoz`, хэштеги). Посты сохраняются в архив JSONL/CSV, по ним строится HTML-дашборд. Запускается одной командой вручную или по cron. В образе уже есть Python, Playwright и Chromium.

Исходники: [github.com/deyrann00/SocNetScraper](https://github.com/deyrann00/SocNetScraper) (оригинал — [ardakshalkar/SocNetScraper](https://github.com/ardakshalkar/SocNetScraper))

## Возможности

- Поиск по ключевым словам и хэштегам через официальный Threads API (если есть токен) или через браузерный поиск
- Архив без дублей: `posts.jsonl` (по одному посту в строке) и `posts.csv`
- HTML-дашборд `index.html` с фильтром «последние 24 часа / 7 дней»
- Сохранение медиа из постов
- JSON-сводка каждого запуска

## Запуск как скрипт

```bash
docker run --rm --env-file .env \
  -v "$PWD/data:/app/data" \
  -v "$PWD/config.json:/app/config.json" \
  deyrann00/socnetscraper scrape
```

| Команда | Что делает |
| --- | --- |
| `scrape` | Собрать посты один раз (по умолчанию). Сначала API, если задан токен, иначе браузер |
| `scrape --browser` | Сразу браузерный поиск, без API |
| `view --file` | Только пересобрать `data/index.html` |
| `daily [--time HH:MM] [--now]` | Не завершаться и собирать раз в день |
| `login` | Войти в Threads и сохранить сессию в `data/` (см. ниже) |

Код выхода `1`, если запуск завершился ошибками и не нашёл ни одного поста.

### Вход в Threads

Без входа Threads часто показывает стену логина. Один раз сохраните сессию: команда откроет браузер на виртуальном дисплее, войдёт с `THREADS_USERNAME` / `THREADS_PASSWORD` и сохранит её в смонтированную папку `data/`:

```bash
docker run --rm --env-file .env -v "$PWD/data:/app/data" \
  --entrypoint xvfb-run deyrann00/socnetscraper python -m socnetscraper login
```

Следующие запуски `scrape` используют сохранённую сессию (`data/storage_state.json`). Если Instagram запросит код подтверждения, выполните `login` на своём компьютере и положите получившийся `data/storage_state.json` в папку `data/` сервера.

### По расписанию (cron)

```cron
# каждый день в 09:00
0 9 * * * docker run --rm --env-file /srv/threads/.env -v /srv/threads/data:/app/data -v /srv/threads/config.json:/app/config.json deyrann00/socnetscraper scrape >> /srv/threads/cron.log 2>&1
```

Вместо cron можно держать контейнер запущенным: `docker run -d --restart unless-stopped ... deyrann00/socnetscraper daily`. Время запуска берётся из `daily_time` в конфиге.

## Переменные окружения

| Переменная | Назначение | Обязательна |
| --- | --- | --- |
| `THREADS_ACCESS_TOKEN` | Токен [официального Threads API](https://developers.facebook.com/docs/threads/keyword-search/) | Нет. Без него используется браузерный поиск |
| `THREADS_USERNAME` | Логин Instagram / Threads | Только для `login` |
| `THREADS_PASSWORD` | Пароль Instagram / Threads | Только для `login` |

Пример `.env`:

```env
THREADS_ACCESS_TOKEN=
THREADS_USERNAME=your_instagram_username
THREADS_PASSWORD=your_password
```

> Не публикуйте `.env` и не вшивайте логины в образ: передавайте их только при запуске.

## Конфигурация (`config.json`)

Монтируется в `/app/config.json`. Если файла нет, используется конфиг из образа.

```json
{
  "keywords": ["нархоз", "narxoz"],
  "hashtags": ["narxoz", "нархоз"],
  "timezone": "Asia/Almaty",
  "daily_time": "09:00",
  "lookback_hours": 24,
  "week_hours": 168,
  "max_scrolls": 10,
  "max_posts_per_query": 80,
  "headless": true,
  "search_filters": ["recent", "default"]
}
```

## Данные (`/app/data`)

| Файл | Содержимое |
| --- | --- |
| `posts.jsonl` | Полный архив постов без дублей |
| `posts.csv` | То же для таблиц |
| `index.html` | HTML-дашборд |
| `media/` | Сохранённые изображения из постов |
| `runs/` | JSON-сводка каждого запуска |
| `storage_state.json` | Сессия Threads после `login`, не публикуйте |

## Плагин для Claude Code

В репозитории есть плагин Claude Code на Node.js, ему не нужны ни Python, ни Docker. Claude сам собирает посты и пересказывает упоминания за неделю.

```text
/plugin marketplace add deyrann00/SocNetScraper
/plugin install narxoz-threads@narxoz-threads-marketplace
```

Команды: `/narxoz-threads:scrape`, `/narxoz-threads:report`, `/narxoz-threads:setup`. Данные лежат в `~/.narxoz-threads`.

## Теги

- `latest`, `0.1.0` — первая версия образа

Платформы: `linux/amd64`, `linux/arm64`.
