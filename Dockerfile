# check=skip=SecretsUsedInArgOrEnv
# Credentials are declared empty on purpose: real values are passed at `docker run`.
FROM python:3.12-slim

LABEL org.opencontainers.image.title="Narxoz Threads Scraper" \
      org.opencontainers.image.description="Daily scraper of public Threads posts about Narxoz University: LLM relevance and sentiment via OpenRouter, JSONL/CSV archive, HTML dashboard" \
      org.opencontainers.image.source="https://github.com/deyrann00/SocNetScraper" \
      org.opencontainers.image.version="0.2.0"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # OpenRouter key for LLM relevance and sentiment analysis; empty = no analysis
    OPENROUTER_API_KEY="" \
    # Optional official Threads API token; empty = browser search
    THREADS_ACCESS_TOKEN="" \
    # Instagram / Threads login, only needed when Threads shows a login wall
    THREADS_USERNAME="" \
    THREADS_PASSWORD=""

WORKDIR /app
COPY pyproject.toml README.md ./
COPY socnetscraper ./socnetscraper
# Editable install: the package resolves data/, logs/ and config.json next to its source in /app.
COPY config.json ./config.json
# xvfb gives `login` (a headed browser) a virtual display inside the container.
RUN pip install -e . \
 && python -m playwright install --with-deps chromium \
 && apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home scraper \
 && mkdir -p /app/data /app/logs \
 && chown -R scraper:scraper /app
USER scraper
VOLUME ["/app/data"]

ENTRYPOINT ["python", "-m", "socnetscraper"]
CMD ["scrape"]
