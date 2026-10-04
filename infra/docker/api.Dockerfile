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
RUN corepack enable
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
CMD ["node", "apps/api/src/main.ts"]
