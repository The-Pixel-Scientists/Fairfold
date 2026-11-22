# ADR 0049: The operator cli runs the release's own commands from a signed tarball

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Aaron Gardner

## Context

A self-hoster needs one way to make the deployment's secrets, set up the
database roles, migrate, create the first tenant and check the result
(V1-PLAN epic E12: a fresh install from the docs in under an hour). The
pieces exist: the roles script and migration runner
(`packages/db/scripts/db.ts`, [ADR 0003](0003-query-builder-and-migrations.md)),
the operator command that creates a tenant
([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md),
[ADR 0024](0024-no-tool-on-by-default.md)), and secrets as files
([ADR 0005](0005-dev-topology.md)).

Constraints:

- Only `packages/db` may import the database driver, and raw SQL stays
  there (`infra/semgrep/`). A tool outside it cannot query the database
  itself.
- No secret may reach an image, a command argument, an environment value
  or a log.
- Every deployment is one cell on any PostgreSQL 16+ and any Compose or
  Kubernetes set-up ([ADR 0012](0012-hosting-targets-and-cells.md));
  nothing may be cloud-specific.
- [ADR 0005](0005-dev-topology.md) says the migrator's credentials are
  mounted only into the migrate job.

## Options considered

1. **A signed tarball run with the host's Node.js.** The release job packs
   the tracked files the API image holds, plus `tools/cli`, signs the
   tarball keyless and attests its SBOMs. The operator verifies it, installs
   the locked production dependencies and runs `node tools/cli/src/main.ts`.
   The cli runs `db.ts` and the operator command as child processes, giving
   each secret as a `*_FILE` path. It works before any deployment exists, so
   `install` can write the secrets where the deployment will mount them.
   It needs Node.js 26 and network access to the database from the
   operator's machine, and that machine holds the role passwords while it
   sets them.
2. **A one-off command in the API image**, run with `docker compose run` or
   as a Kubernetes Job. The scripts and the image can never drift, the host
   needs no Node.js, and the credentials stay inside the deployment. But
   `install` has no host folder to write to, each orchestrator needs its own
   wrapper, and it waits on the self-hosted Compose file and the Helm chart,
   neither of which exists yet.

## Decision

Option 1 for cli v0. The cli changes nothing itself: every database step is
`db.ts` (`prepare`, `up`, and a read-only `status`) or the operator command,
from the same tagged commit as the images. Secrets live one per file, mode
0600, in an owner-only folder outside the release folder; the cli refuses a
folder or file other users can open, a link, and on Windows, where it cannot
check file permissions, it stops and points to WSL. It connects to a database
server elsewhere only with `TPS_DB_TLS=verify-full`, and runs the roles script
as a superuser only on the operator's own machine; a managed database uses
`TPS_DB_ADMIN_MODE=managed`, with the admin password typed at a no-echo
prompt and handed to the roles script through a pipe, never a file.

For installs the cli sets up, this amends [ADR 0005](0005-dev-topology.md):
the operator's machine holds the migrator's and the other roles' passwords
during set-up, as files the cli never prints. The API and worker still never
receive the migrator's credentials, and the managed service keeps its migrate
job.

## Consequences

- One command line installs, sets up and checks a deployment, with no secret
  in an argument, a setting's value or the output.
- The release job publishes `cli-vX.Y.Z` tags separately from the images, so
  a cli fix does not need a new image, and the tarball's version is checked
  against `tools/cli/package.json`.
- Option 2 stays open: once the self-hosted Compose file and the Helm chart
  exist, the same commands can run from the API image, which already holds
  every file the cli runs.
- `install` writes Compose inputs only. Helm inputs wait on the chart, and
  storage keys come from the S3 provider or the bundled store's set-up.
