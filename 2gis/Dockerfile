# check=skip=SecretsUsedInArgOrEnv
# The env vars below are declared empty on purpose: real keys are passed at `docker run`.
# Build the bundled MCP server from TypeScript sources.
FROM node:22-alpine AS build
WORKDIR /src/plugins/mcp
COPY plugins/mcp/package.json plugins/mcp/package-lock.json ./
RUN npm ci
COPY plugins/mcp/ ./
RUN npm run build

# Runtime: the bundle has no dependencies, only Node is needed.
FROM node:22-alpine
LABEL org.opencontainers.image.title="Narxoz 2GIS Scraper" \
      org.opencontainers.image.description="MCP server: 2GIS reviews of Narxoz University, LLM relevance and sentiment via OpenRouter, email reports" \
      org.opencontainers.image.source="https://github.com/deyrann00/Narxoz2GisScraper" \
      org.opencontainers.image.version="0.4.1" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    NARXOZ_2GIS_ROOT=/app \
    # OpenRouter key for LLM analysis; empty = sentiment from star ratings
    OPENROUTER_API_KEY="" \
    # SMTP login and password (Gmail: app password) for emailing the report
    SMTP_USER="" \
    SMTP_PASS=""
WORKDIR /app
COPY --from=build /src/plugins/claude/server/index.js ./server/index.js
COPY config.json ./config.json
RUN mkdir -p /app/data/runs && chown -R node:node /app
USER node
VOLUME ["/app/data"]

# MCP server over stdio: run with `docker run -i`.
ENTRYPOINT ["node", "/app/server/index.js"]
