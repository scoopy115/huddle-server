# Huddle Server — the Huddle engine headless, with the dashboard. CPU image (x86_64 / arm64).
#
# The engine lives in the Huddle repo. The build takes it from vendor/engine when
# scripts/fetch-engine.sh put it there (local builds, CI), otherwise it clones the public Huddle
# repo itself — so a plain `docker build .` of this repository works, including on Coolify or any
# other host that builds straight from git.
#   --build-arg HUDDLE_ENGINE_REF=v0.10.1   pin the engine to a tag or commit (default: main)

# Official images through AWS's public mirror: no Docker Hub pull-rate limit on CI runners.
FROM public.ecr.aws/docker/library/alpine:3.20 AS engine
ARG HUDDLE_ENGINE_REPO=https://github.com/scoopy115/huddle.git
ARG HUDDLE_ENGINE_REF=main
RUN apk add --no-cache git
COPY vendor/ /vendor/
RUN if [ -f /vendor/engine/pyproject.toml ]; then echo "engine <- vendor/engine" && cp -r /vendor/engine /engine; \
    else echo "engine <- $HUDDLE_ENGINE_REPO@$HUDDLE_ENGINE_REF" \
      && git clone --depth 1 --filter=blob:none --sparse --branch "$HUDDLE_ENGINE_REF" "$HUDDLE_ENGINE_REPO" /src \
      && git -C /src sparse-checkout set engine && mv /src/engine /engine && rm -rf /src; fi \
    && rm -rf /engine/.venv* /engine/dist.nosync /engine/build.nosync /engine/__pycache__ \
    && grep -m1 '^version' /engine/pyproject.toml

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
COPY --from=engine /engine /app/engine
RUN pip install /app/engine
COPY server/ /app/server/
COPY --from=dashboard /dash/dist /app/server/huddle_server/static
RUN pip install /app/server && rm -rf /app/engine /app/server
VOLUME ["/data", "/certs"]
EXPOSE 48731
HEALTHCHECK --interval=30s --timeout=20s --start-period=120s --retries=10 CMD curl -fsS http://127.0.0.1:48731/health || exit 1
CMD ["huddle-server", "serve"]
