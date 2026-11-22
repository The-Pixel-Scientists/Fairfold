# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The off-site backup job's release image (infra/backup/, ADR 0011): the
# job's code and the database settings modules it imports, run on Node.js's
# own type stripping. The job adds no npm dependency, so nothing is installed
# but the commands it calls, from Debian, linked into /usr/local/bin: pg_dump
# and psql from PostgreSQL 17's client, newer than the server as pg_dump must
# be, age, and AWS CLI version 2.
#
#   docker build --file infra/docker/backup.Dockerfile .
#
# Build context: the repository root. backup.Dockerfile.dockerignore lists the
# only files sent.

FROM node:26.12.1-trixie-slim@sha256:94816674c62774da0d099a947bf4613b9e1972a2733abd0d0cd80e795f8411d0

# The base image can trail Debian's security fixes, which the release scan fails on.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends age awscli ca-certificates postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/17/bin/psql \
      /usr/bin/age /usr/bin/aws /usr/local/bin/
ENV NODE_ENV=production
# Node.js is all the job needs of the base image. npm, Corepack and Yarn would only add code to patch.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY . .
USER node
CMD ["node", "infra/backup/src/main.ts"]
