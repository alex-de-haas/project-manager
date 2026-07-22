# syntax=docker/dockerfile:1.7

# Pinned by digest for reproducible builds. To update: re-pin with
#   docker buildx imagetools inspect node:24-bookworm-slim --format '{{.Manifest.Digest}}'
FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_HOST_MODULE_ID=com.haas.project-manager

FROM base AS deps
# better-sqlite3 ships no prebuilt binary for this image, so npm falls back to
# compiling it from source via node-gyp — which needs Python and a C++ toolchain.
# These stay in the deps/prod-deps layers; the final runner image only copies
# the built node_modules, so it isn't bloated by them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --prefer-offline

FROM deps AS prod-deps
RUN npm prune --omit=dev

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
COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/data \
  && chown -R node:node /app

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
