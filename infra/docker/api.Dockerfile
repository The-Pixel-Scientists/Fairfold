# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The API release image (ADR 0005): the API, packages/db with its migrations
# and migration tooling, packages/domain, and their production dependencies.
# The API runs on Node.js's own type stripping, so nothing is compiled. The
# same image runs the one-off migrate job, with another command. It holds no
# seed code, test or development credential.
#
# Build context: the repository root. api.Dockerfile.dockerignore lists the
# only files sent.

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /app
# Corepack at an exact version (ADR 0026); it installs pnpm from
# packageManager and checks its hash.
RUN npm install --global --ignore-scripts corepack@0.36.0 && corepack enable
COPY . .
RUN --mount=type=cache,id=tps-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm-store --filter "@pixel-scientists/api..."

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ENV NODE_ENV=production
# Node.js is all the API needs. npm, Corepack and Yarn would only add code to patch.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 3000
# Liveness only: GET /health needs no database, so a database outage leaves
# the container healthy and readiness is the platform's probe. It calls
# 127.0.0.1, which answers while TPS_API_HOST is 0.0.0.0 or loopback. The
# migrate job runs from this image too; Compose waits for it to exit, not on
# this check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "--eval", "fetch('http://127.0.0.1:' + (process.env.TPS_API_PORT ?? 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/src/main.ts"]
