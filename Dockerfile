# check=skip=SecretsUsedInArgOrEnv
# Secrets are declared empty on purpose: real values are passed at `docker run`.

# 2GIS scraper + combined report: bundle the TypeScript into one file.
FROM node:22-alpine AS twogis
WORKDIR /src/plugins/mcp
COPY 2gis/plugins/mcp/package.json 2gis/plugins/mcp/package-lock.json ./
RUN npm ci
COPY 2gis/plugins/mcp/ ./
RUN npm run build

# Runtime: Python + Playwright Chromium for Threads, Node for 2GIS and the report.
FROM python:3.12-slim
LABEL org.opencontainers.image.title="Narxoz Scraper" \
      org.opencontainers.image.description="2GIS reviews and Threads mentions of Narxoz University in one report: LLM relevance, sentiment and overall analysis via OpenRouter, email" \
      org.opencontainers.image.source="https://github.com/deyrann00/NarxozScraper" \
      org.opencontainers.image.version="1.0.0"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NARXOZ_2GIS_ROOT=/data/2gis \
    NARXOZ_SCRAPER_ROOT=/data/threads \
    NARXOZ_REPORT_PATH=/data/report.html \
    # OpenRouter key: per-mention analysis and the overall summary; empty = no LLM
    OPENROUTER_API_KEY="" \
    # SMTP login and password (Gmail: app password) for emailing reports
    SMTP_USER="" \
    SMTP_PASS="" \
    # Optional official Threads API token; empty = browser search
    THREADS_ACCESS_TOKEN="" \
    # Instagram / Threads login, only for `narxoz login`
    THREADS_USERNAME="" \
    THREADS_PASSWORD=""

WORKDIR /app
COPY threads/pyproject.toml threads/README.md threads/config.json ./threads/
COPY threads/socnetscraper ./threads/socnetscraper
# xvfb gives `narxoz login` (a headed browser) a virtual display.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs xvfb xauth \
 && pip install -e ./threads \
 && python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY --from=twogis /src/plugins/claude/server/index.js ./2gis/server/index.js
COPY 2gis/config.json ./2gis/config.json
COPY scripts/narxoz.sh /usr/local/bin/narxoz
RUN chmod +x /usr/local/bin/narxoz \
 && useradd --create-home scraper \
 && mkdir -p /data \
 && chown -R scraper:scraper /app /data
USER scraper
VOLUME ["/data"]

ENTRYPOINT ["narxoz"]
CMD ["all"]
