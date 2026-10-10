# Huddle Server — the Huddle engine headless, with the dashboard. CPU image (x86_64 / arm64).
# Build context needs vendor/engine (scripts/fetch-engine.sh) — the engine lives in the Huddle repo.

# Official images through AWS's public mirror: no Docker Hub pull-rate limit on CI runners.
FROM public.ecr.aws/docker/library/node:22-alpine AS dashboard
WORKDIR /dash
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN npm run build

FROM public.ecr.aws/docker/library/python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HUDDLE_DATA_DIR=/data HUDDLE_TLS_DIR=/certs HUDDLE_HOST=0.0.0.0 HUDDLE_PORT=48731 \
    HF_HOME=/data/hf HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY vendor/engine /app/engine
RUN pip install /app/engine
COPY server/ /app/server/
COPY --from=dashboard /dash/dist /app/server/huddle_server/static
RUN pip install /app/server && rm -rf /app/engine /app/server
VOLUME ["/data", "/certs"]
EXPOSE 48731
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 CMD curl -fsS http://127.0.0.1:48731/health || exit 1
CMD ["huddle-server", "serve"]
