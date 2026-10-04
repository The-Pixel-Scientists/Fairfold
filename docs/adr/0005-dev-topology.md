# ADR 0005: Development topology

- **Status:** accepted
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

Developers need fast reload for three apps, plus PostgreSQL, a mail catcher,
S3-compatible storage and ClamAV. Pieces of work run in parallel, each in its
own git worktree, and must not share a database. Epic E1 in the
[V1 plan](../V1-PLAN.md#e1-platform-foundation) wants the full stack with
synthetic seed data from one command. The main development machine runs
Windows, where bind-mounting a checkout into Linux containers makes file
watching slow and unreliable, and Windows `node_modules` do not run in Linux.

MinIO was the expected storage service. Its community repository is now
archived and its README says it is no longer maintained. The last community
release was 15 October 2025, and the alternatives it points to are not open
source.

Self-hosters run the same images from their own Compose file, so what is
convenient in development (fixed credentials, seed data) must not leak into a
real install.

## Options considered

1. **Everything in containers, even in development.**
   - Pros: closest to production.
   - Cons: slow watching through bind mounts on Windows, platform mismatch in
     `node_modules`, slower feedback on every save.
2. **Services in Compose, apps native.** Vite serves the console and portal,
   and tsx watches the API. A separate command runs everything in containers.
   - Pros: sub-second reload, native debugging, and the same images still
     tested end to end.
   - Cons: two ways to run the stack, so both need to stay working.
3. **No containers: install services on each machine.**
   - Cons: version drift, and ClamAV is painful on Windows.

For storage, the S3-compatible candidates were:

- SeaweedFS (Apache-2.0): around since 2014, weekly releases, one container.
- RustFS (Apache-2.0): a MinIO-like drop-in, but it reached 1.0 on
  16 September 2026.
- Garage (AGPL-3.0): built for small self-hosted clusters, but needs a layout
  step after first start, which hurts one-command set-up.
- Versity S3 Gateway (Apache-2.0): S3 over a plain directory. Simple, with a
  smaller community.

## Decision

Option 2, with SeaweedFS in place of MinIO, as Aaron has confirmed. Images
are pinned by digest under the release-age rule in
[ADR 0001](0001-monorepo-toolchain.md).

| Service | Image | Licence | Purpose |
| --- | --- | --- | --- |
| PostgreSQL 16.15 | `postgres` | PostgreSQL License | Our floor version. CI also runs the database tests on 18.6. |
| Mailpit 1.31.2 | `axllent/mailpit` | MIT | Catches all mail; web inbox on localhost |
| SeaweedFS 4.47 | `chrislusf/seaweedfs` | Apache-2.0 | S3 API for uploads |
| ClamAV 1.5.4 | `clamav/clamav` | GPL-2.0, separate program | Scans uploads over the clamd TCP protocol |

Commands:

- `pnpm dev` starts the services if they are not running, creates this
  worktree's database if missing, migrates and seeds it, then runs the API,
  console and portal natively with reload.
- `pnpm stack` builds the production images and runs everything in
  containers: migrations as a one-off job, API, worker, console, portal and
  services. It uses its own Compose project and database, generates its own
  secrets as a self-hosted install does, and publishes ports on 127.0.0.1
  only. Release images hold no seed code, so it seeds from the checkout on
  the host, through the stack's loopback database port.
- `pnpm db:migrate`, `pnpm db:rollback` and `pnpm db:reset` only ever touch
  this worktree's database.

Isolation and naming:

- All worktrees share one set of service containers under a fixed Compose
  project name, with data in named volumes.
- A script derives names from the worktree folder, lower-cased with every
  character outside `[a-z0-9_]` replaced by `_`: database
  `tps_<worktree>` (for example `tps_2026_w40`), test database
  `tps_<worktree>_test`, bucket `tps-<worktree>` (with hyphens,
  as S3 requires), and a block of ports for the API, console and portal. Two
  worktrees never share any of them.
- The console and portal are served as `console.localhost` and
  `portal.localhost` on their ports, and each app reaches the API
  same-origin through its dev server, so `pnpm dev` and `pnpm stack` run as a
  two-host install and never trigger the single-host warning in
  [ADR 0010](0010-authentication-security-rules.md). Browsers resolve
  `*.localhost` to loopback without any hosts-file change.
- PostgreSQL roles are shared across the whole server, so any role a test
  creates (such as the throwaway role in ADR 0009's per-state tests) is named
  after that worktree's test database and dropped afterwards.
- PostgreSQL cuts identifiers at 63 bytes. A name that would be longer is
  shortened and given a hash of the full name, so two long names never
  collide.
- `pnpm db:drop` refuses any database name that does not start with
  `tps_`.
- The roles script from [ADR 0003](0003-query-builder-and-migrations.md)
  runs as superuser when the Postgres container is first created, and again
  before each migration run. Migrations never create or alter a role.

Credentials and seed data:

- Development credentials are fixed, obviously fake and live only in the
  development Compose file; ports bind to 127.0.0.1. The gitleaks allowlist
  covers that one file and nothing else.
- The self-hosted Compose file in `infra/compose/` has no defaults. Its
  install step generates every secret with a cryptographically secure random
  generator and writes each to its own file with mode 0600, mounted as a
  Compose secret. Secrets are never baked into images or passed as build
  arguments.
- The migrator's credentials are mounted only into the migrate job. The API
  and worker never receive them.
- The API and worker always check their secrets at start-up, and refuse to
  start if one is missing, shorter than its minimum length, or equal to a
  known development value. Only an explicit development flag lets
  development values through, and it also makes every listener bind to
  127.0.0.1. `pnpm dev` and the seed command set it; release images and the
  services `pnpm stack` runs never do. There are no fallback values in code.
- Seeding refuses to run without the development flag, or when the database
  name does not start with `tps_`. Seed code and fixtures are not
  copied into release images.

Files:

- Uploads land under a quarantine prefix and are served only after a clean
  verdict from ClamAV.
- Scanner errors, timeouts, exceeded limits and encrypted content all count
  as not clean. clamd runs with `AlertExceedsMax yes`, `StreamMaxLength` at or
  above the upload limit, and `AlertEncrypted yes`.
- In `pnpm stack` and self-hosted installs, clamd and SeaweedFS sit on an
  internal Compose network with no published ports. In `pnpm dev`, where the
  API runs on the host, clamd and SeaweedFS's S3 port publish to 127.0.0.1;
  SeaweedFS's other ports are not published. On Linux, development needs
  Docker Engine 28 or later, which stops other machines on the network
  reaching ports published to 127.0.0.1.
- SeaweedFS runs with one S3 key pair per purpose, each limited to one bucket
  and the prefixes it needs: uploads write only to quarantine, the scanner
  reads quarantine and writes clean, and the presign identity for downloads
  reads only clean. Its own servers sign requests between them with JWTs.
- Uploads use an S3 POST policy with a `content-length-range` condition, an
  object key the server generates, and no `success_action_redirect`.
- In the self-hosted stack the reverse proxy forwards one route to storage:
  `POST` only, never `GET`, to one exact path for one bucket, with a body
  limit at the upload maximum and paths normalised before matching.
- Downloads are proxied by the API by default and send
  `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` and a
  fixed content type. A presigned download is issued only after the
  permission, blind-review and audit checks, lasts 5 minutes or less, and
  forces the same disposition and content type. It is used only where
  browsers can reach storage and a test shows storage sends `nosniff`; the
  self-hosted stack forwards no `GET` to storage, so never there.
- A fuller files ADR comes before E6.

## Consequences

- CONTRIBUTING's development set-up section describes `pnpm dev` and
  `pnpm stack` when the toolchain lands in sprint 1.
- A container engine that runs Compose files is needed on every development
  machine and CI runner; on Linux, Docker Engine 28 or later.
- ClamAV holds its signature database in memory, more than 1 GB, and
  downloads signatures on first start. CI caches them. Tests use the EICAR
  test file, an encrypted archive and a file over the limit, and expect all
  three to stay in quarantine.
- The app uses only a small part of the S3 API (put, get, head, delete,
  multipart upload, POST policy and presigned URLs). CI tests that part
  against SeaweedFS, so operators can point at any S3-compatible service. The
  managed service checks its Cloud Storage set-up against the same tests.
- Old worktree databases pile up. `pnpm db:drop` removes the current
  worktree's database before the worktree is deleted.

## Dependency check

| Package or image | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| PostgreSQL | 16.15 | PostgreSQL License | 2026-08-10 (tag) | 18.6 is newest stable; 19 in beta. Image tags are rebuilt, so the digest is chosen under the 7-day rule |
| Mailpit | 1.31.2 | MIT | 2026-09-19 | Active; 1.31.3 is too new |
| SeaweedFS | 4.47 | Apache-2.0 | 2026-09-14 | Weekly releases; 35k stars |
| ClamAV | 1.5.4 | GPL-2.0 | 2026-08-07 | Active; Cisco Talos |
| MinIO (rejected) | RELEASE.2025-10-15 | AGPL-3.0 | 2025-10-16 | Repository archived; unmaintained |
| RustFS (not chosen) | 1.0.0 | Apache-2.0 | 2026-09-16 | Created 2023; very new 1.0 |
| Garage (not chosen) | 2.4.1 | AGPL-3.0 | 2026-09-07 (tag) | Main repository on its own forge; GitHub mirror active |
| Versity S3 Gateway (not chosen) | 1.8.0 | Apache-2.0 | 2026-09-04 | Active; 2.9k stars |
| tsx | 4.23.15 | MIT | 2026-09-20 | API watch mode |
| vite | 8.3.0 | MIT | 2026-09-10 | Console and portal dev servers; 8.3.1 is too new |
| @vitejs/plugin-react | 6.1.1 | MIT | 2026-08-28 | Active |
