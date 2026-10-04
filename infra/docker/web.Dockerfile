# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The console or portal release image (ADRs 0005 and 0006): the production
# build, served by scripts/web-server.ts with the Content Security Policy and
# a fresh nonce on each page.
#
#   docker build --file infra/docker/web.Dockerfile --build-arg APP=console .
#
# Build context: the repository root. web.Dockerfile.dockerignore lists the
# only files sent.

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

ARG APP
WORKDIR /app
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=tps-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@pixel-scientists/${APP}..."
# The component gallery is for development only. A build that kept it, for
# example one run with NODE_ENV=development, must never ship: not its route,
# its title or its chunk.
RUN pnpm --filter "@pixel-scientists/${APP}" build \
    && if grep -rqE '/dev/components|Component gallery' "apps/${APP}/dist" \
      || find "apps/${APP}/dist/assets" -name '*Gallery*' | grep -q .; then \
      echo "apps/${APP}/dist holds the component gallery. Build it for production." >&2; \
      exit 1; \
    fi

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ARG APP
# Node.js is all the server needs. npm, Corepack and Yarn would only add code to patch.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /app/apps/${APP}/dist dist
COPY --from=build /app/scripts/web-server.ts web-server.ts
USER node
EXPOSE 8080
CMD ["node", "web-server.ts", "--root", "dist", "--host", "0.0.0.0", "--port", "8080"]
