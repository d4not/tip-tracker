# Multi-stage build. Native build tools in the builder; slim runtime.

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Build deps for better-sqlite3 (compiled native module).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# ------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/tips.db

WORKDIR /app

# Run as non-root and own /data for SQLite files.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin tiptracker \
  && mkdir -p /data && chown -R tiptracker:tiptracker /data

COPY --from=builder --chown=tiptracker:tiptracker /app /app

USER tiptracker

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "app.js"]
