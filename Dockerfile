# syntax=docker/dockerfile:1.7

# Pinned by digest for reproducible builds. To update: re-pin with
#   docker buildx imagetools inspect node:24-bookworm-slim --format '{{.Manifest.Digest}}'
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_HOST_MODULE_ID=com.haas.project-manager

FROM base AS deps
# better-sqlite3 ships no prebuilt binary for this image, so npm falls back to
# compiling it from source via node-gyp — which needs Python and a C++ toolchain.
# These stay in the deps layer; the runner image receives only the traced standalone
# bundle, so it isn't bloated by them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --prefer-offline

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public .next/cache
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
# gosu lets the entrypoint drop from root to the unprivileged `node` user after fixing data-dir
# ownership (see docker-entrypoint.sh).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*
# `output: "standalone"` (next.config.js) traces the runtime file set: server.js, the resolved
# next.config, and only the node_modules the server actually requires. Static assets and public/
# are not traced, so they are copied separately as the Next docs prescribe.
#
# --chown on each COPY stamps ownership while the layer is written. A `chown -R` afterwards would
# instead rewrite every file's metadata, and overlayfs would copy the whole tree into an extra
# layer — that alone cost 653 MB before this stage was reworked.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && install -d -o node -g node /app/data /app/.next/cache

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
