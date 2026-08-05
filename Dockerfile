# syntax=docker/dockerfile:1.7

# Trixie (Debian 13, glibc 2.41) rather than bookworm (2.36): better-sqlite3 13 ships its own
# `prebuilds/linux-{x64,arm64}.node`, and those are linked against GLIBC_2.38. Whenever that
# prebuild is what ends up loaded, bookworm fails to dlopen it, which surfaces at `next build`
# as "Failed to collect page data" — the build imports src/lib/db.ts, whose module-level
# `new Database(...)` needs a loadable binding.
#
# Pinned by digest for reproducible builds. To update: re-pin with
#   docker buildx imagetools inspect node:24-trixie-slim --format '{{.Manifest.Digest}}'
FROM node:24-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_HOST_MODULE_ID=com.haas.project-manager

FROM base AS deps
# better-sqlite3 resolves its native binding one of two ways, and which one wins depends on
# whether npm executes the package's `install: node-gyp rebuild` lifecycle script. That is not
# stable across environments: on the CI runner npm withholds the script until it is approved and
# logs
#   npm warn allow-scripts better-sqlite3@13.0.2 (install: node-gyp rebuild)
# so the bundled prebuild is what gets loaded there, while a local `docker build` runs the script
# and compiles from source instead. Keep the toolchain so the compile path works when it is taken;
# the trixie base above covers the prebuild path. Both stay in the deps layer; the runner image
# receives only the traced standalone bundle, so it isn't bloated by them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --prefer-offline

FROM base AS builder
# next.config.js opts into `output: "standalone"` on this flag alone, so the traced bundle is
# produced for the image while a plain `npm run build` / `next start` elsewhere stays unaffected.
ENV NEXT_OUTPUT_STANDALONE=1
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
# The optimizer cache is mode 1777 because the entrypoint may run the server as the data mount's
# owner rather than `node` (see docker-entrypoint.sh) — sticky like /tmp, and it holds only derived,
# non-secret output.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && install -d -o node -g node /app/data \
  && install -d -o node -g node -m 1777 /app/.next/cache

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
