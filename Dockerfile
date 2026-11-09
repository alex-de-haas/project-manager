# syntax=docker/dockerfile:1.7

# Trixie (Debian 13, glibc 2.41) rather than bookworm (2.36): better-sqlite3 13 ships its own
# `prebuilds/linux-{x64,arm64}.node`, and those are linked against GLIBC_2.38. Whenever that
# prebuild is what ends up loaded, bookworm fails to dlopen it, which surfaces at `next build`
# as "Failed to collect page data" — the build imports src/lib/db.ts, whose module-level
# `new Database(...)` needs a loadable binding.
#
# Pinned by digest for reproducible builds. To update: re-pin with
#   docker buildx imagetools inspect node:24-trixie-slim --format '{{.Manifest.Digest}}'
FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_HOST_MODULE_ID=com.haas.project-manager
# A fixed signed archive closes the runtime apt input set.
COPY docker/debian.sources /etc/apt/sources.list.d/debian.sources

FROM base AS deps
COPY package.json package-lock.json ./
# Use the native binaries shipped in the integrity-checked locked packages.
# Lifecycle scripts stay disabled so they cannot fetch untracked build inputs.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --prefer-offline

FROM base AS builder
ARG TARGETOS
ARG TARGETARCH
# next.config.js opts into `output: "standalone"` on this flag alone, so the traced bundle is
# produced for the image while a plain `npm run build` / `next start` elsewhere stays unaffected.
ENV NEXT_OUTPUT_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.js tsconfig.json postcss.config.mjs tailwind.config.ts vitest.config.ts ./
COPY src ./src
COPY public ./public
# Preserve the TypeScript coverage from tsconfig.json, including test sources.
COPY test ./test
RUN mkdir -p public .next/cache
# Next's trace cache includes architecture-specific native bindings. Never share it across
# platforms: a warm cache from another target can omit the binding from standalone output.
RUN --network=none --mount=type=cache,id=project-manager-next-${TARGETOS}-${TARGETARCH},target=/app/.next/cache npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
# Standalone Next reads HOSTNAME; Docker's container hostname excludes loopback healthchecks.
ENV HOSTNAME=0.0.0.0
# gosu lets the entrypoint drop from root to the unprivileged `node` user after fixing data-dir
# ownership (see docker-entrypoint.sh).
RUN apt-get -o APT::Update::Error-Mode=any update \
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
# The optimizer cache is mode 1777 because the entrypoint may run the server as the data mount's
# owner rather than `node` (see docker-entrypoint.sh) — sticky like /tmp, and it holds only derived,
# non-secret output.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && install -d -o node -g node /app/data \
  && install -d -o node -g node -m 1777 /app/.next/cache
# Test the final traced bundle, not the complete builder dependencies. next build can succeed
# even when standalone tracing omits the native binding needed by the runtime healthcheck.
RUN gosu node node -e 'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.prepare("SELECT 1").get(); db.close();'

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
