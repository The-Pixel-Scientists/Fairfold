# SPDX-License-Identifier: AGPL-3.0-or-later
#
# PostgreSQL for development (infra/compose/compose.dev.yaml): the pinned
# official image plus the roles script, which runs on the container's first
# start. The files are copied in rather than bind-mounted, so the image works
# wherever the checkout lives, including drives Docker cannot share.
#
# Build contexts, set by the Compose file:
#   default     infra/compose/postgres
#   db-scripts  packages/db/scripts

FROM postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650

RUN install --directory --mode=0755 /pixelgrant
COPY --chmod=0755 initdb/10-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
COPY --from=db-scripts --chmod=0644 roles.sql /pixelgrant/roles.sql

# The entrypoint supports running as the postgres user from the start, which
# it otherwise switches to after preparing the data directory as root.
USER postgres
