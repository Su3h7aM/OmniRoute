FROM oven/bun:1.3.12-debian AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY bunfig.toml ./
COPY open-sse/package.json ./open-sse/package.json
COPY scripts/postinstall.ts ./scripts/postinstall.ts
COPY scripts/postinstallSupport.ts ./scripts/postinstallSupport.ts
RUN bun install --frozen-lockfile || bun install

COPY . ./
RUN mkdir -p /app/data && bun run build

FROM oven/bun:1.3.12-debian AS runner-base
WORKDIR /app

LABEL org.opencontainers.image.title="omniroute" \
  org.opencontainers.image.description="Unified AI proxy — route any LLM through one endpoint" \
  org.opencontainers.image.url="https://omniroute.online" \
  org.opencontainers.image.source="https://github.com/diegosouzapw/OmniRoute" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV DATA_DIR=/app/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && chown -R bun:bun /app

COPY --chown=bun:bun --from=builder /app/public ./public
COPY --chown=bun:bun --from=builder /app/.next/static ./.next/static
COPY --chown=bun:bun --from=builder /app/.next/standalone ./
COPY --chown=bun:bun --from=builder /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
COPY --chown=bun:bun --from=builder /app/node_modules/pino-abstract-transport ./node_modules/pino-abstract-transport
COPY --chown=bun:bun --from=builder /app/node_modules/pino-pretty ./node_modules/pino-pretty
COPY --chown=bun:bun --from=builder /app/node_modules/split2 ./node_modules/split2
COPY --chown=bun:bun --from=builder /app/scripts/run-standalone.ts ./run-standalone.ts
COPY --chown=bun:bun --from=builder /app/scripts/runtime-env.ts ./runtime-env.ts
COPY --chown=bun:bun --from=builder /app/scripts/bootstrap-env.ts ./bootstrap-env.ts
COPY --chown=bun:bun --from=builder /app/scripts/healthcheck.mjs ./healthcheck.mjs

USER bun

EXPOSE 20128

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "healthcheck.mjs"]

CMD ["bun", "run-standalone.ts"]

