# ADR 0003: Query builder, migrations and database roles

- **Status:** accepted
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

The [technical baseline](../V1-PLAN.md#technical-baseline) calls for a typed
SQL query builder with versioned migrations, Drizzle or Kysely, reviewed like
code. Constraints:

- Tenant isolation is row-level security (RLS). Policies, grants, helper
  functions and the append-only grant on `audit_event` get line-by-line review.
- Every migration is reversible or has a documented rollback, and
  `pnpm db:rollback` undoes the last one locally.
- Vanilla PostgreSQL 16+, with no extension we cannot get everywhere.

RLS fails open in quiet ways: a table owner or `BYPASSRLS` role, a view that
runs as its owner, a definer function, a missing policy for one command, a
policy that forgets the tenant, or a query run with no tenant set. The rules
below close each of these, and a catalogue test checks them.

## Options considered

1. **Kysely, with hand-written `up.sql` and `down.sql` per migration.**
   - Pros: a thin, typed builder that reads like SQL and runs no hidden
     queries. Its `Migrator` takes an advisory lock, runs a batch in one
     transaction and has `migrateDown()`, so `pnpm db:rollback` needs no
     extra tool. pg-boss and Better Auth both work with Kysely (ADRs
     [0009](0009-background-jobs.md) and [0007](0007-authentication.md)).
   - Cons: still 0.x, and minor versions can break. Types need code
     generation. Writing every migration by hand is slower.
2. **Drizzle ORM, with Drizzle Kit generating migrations from a TypeScript
   schema.**
   - Pros: schema and types in one place, no codegen step, generated SQL for
     routine changes, RLS policies and roles declared in the schema, and a
     larger community.
   - Cons: Drizzle Kit has no down migrations (requested since May 2024,
     issue 2352), so we would hand-write every down file anyway and keep two
     sources of truth. Stable is 0.45.3 while 1.0 is at release candidate, so
     a breaking upgrade is due mid-V1.
3. **Kysely for queries, node-pg-migrate for migrations.** A mature runner,
   but a second tool for what Kysely's migrator already does.

## Decision

Option 1: Kysely 0.29.6 on the pg 8.23.0 driver. We accept writing SQL by
hand: the SQL we review is what protects tenants, so it should be what we
write.

### Migrations

- Each migration is a folder, `packages/db/migrations/NNNN_description/`,
  holding `up.sql` and `down.sql`. A small provider in `packages/db/scripts/`
  feeds them to Kysely's `Migrator`, which keeps its history in a
  `migrations` schema.
- `pnpm db:migrate` and `pnpm db:rollback` run as `migrator` against the
  worktree's own database ([ADR 0005](0005-dev-topology.md)). The app never
  connects as `migrator`.
- `down.sql` restores the previous schema, grants and policies. Where data
  cannot come back (a dropped column), it raises an error naming the
  documented rollback, such as a restore.
- kysely-codegen generates types from the migrated database into
  `packages/db/src/generated/`. CI regenerates them and fails on any diff.

### Roles

| Role | Used by | Rights |
| --- | --- | --- |
| `migrator` | The migrate job only | Owns every schema object |
| `app_api`, `app_worker` | API, and job handlers in the worker | Explicit grants only |
| `app_queue` | pg-boss's own connection in the worker ([ADR 0009](0009-background-jobs.md)) | Grants in schema `pgboss`; outside it, only `USAGE` on schema `app`, `SELECT` on `app.job_queue` and `EXECUTE` on `app.current_tenant_id()`, which the job trigger uses |
| `app_auth` | `apps/api/src/auth` only | Grants in schema `auth`; outside it, only `USAGE` on schema `app` and `EXECUTE` on `app.current_tenant_id()`, which its policies call |
| One owner per approved definer function | That function | `NOLOGIN`; owns only its function; exactly the grants listed below |

- Every role above is `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`,
  `NOCREATEDB` and `NOREPLICATION`, and belongs to no other role. The app
  roles own nothing.
- A roles script in `packages/db/scripts/` creates the roles and resets their
  attributes. It is idempotent and versioned, and the install and upgrade
  procedures run it as superuser before migrating. It also revokes from
  `PUBLIC` the `EXECUTE` on functions, `TEMP` on the database and `CREATE` on
  every schema, and runs `ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE
  EXECUTE ON FUNCTIONS FROM PUBLIC`, so functions that later migrations
  create, pg-boss's included, start with no `PUBLIC` grant. Nothing else uses
  superuser credentials, and no migration creates or alters a role.
- The migrate job, API and worker check at start-up that the roles script
  version is the one they expect and that every role has the attributes
  above. They refuse to start if not.

### Row-level security

1. Every table in an application schema (any schema that is not
   PostgreSQL's own) is either a tenant table, with a `tenant_id` column, or
   on the allowlist below.
2. Tenant tables have `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy for
   every command (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), never `FOR ALL`.
3. In every permissive policy, `tenant_id = app.current_tenant_id()` is a
   top-level `AND` term of its `USING` and `WITH CHECK` expressions, whichever
   the command has, so no `OR` can widen it. Every `UPDATE` policy states
   `WITH CHECK` explicitly.
4. A command that no app role may run on a table has no grant and a
   restrictive policy: `AS RESTRICTIVE FOR <command> TO app_api, app_worker,
   app_queue, app_auth USING (false)`, or `WITH CHECK (false)` for `INSERT`.
5. `app.current_tenant_id()` is `STABLE` and returns
   `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. With no tenant
   set, every policy matches nothing; a test proves it for every tenant table.
6. Every tenant table has `UNIQUE (tenant_id, id)`, and every foreign key
   between tenant tables includes `tenant_id`: `(tenant_id, parent_id)` to
   `(tenant_id, id)`. Business unique constraints include `tenant_id`.
7. Views are created `WITH (security_invoker = true)`. Materialized views over
   tenant data, and `SECURITY DEFINER` functions, need an ADR. An approved
   definer function sets `search_path = pg_catalog, pg_temp` and qualifies
   every name.

The allowlist and named exceptions, each known to the catalogue test by name:

| Object | Exception |
| --- | --- |
| `app.tenant` | Keyed by `id`, so app role policies use `id = app.current_tenant_id()`. One more `SELECT` policy, `TO` the owner of `app.tenant_ids()`, is `USING (true)`; that owner has column grants on `id` and `status` only |
| `auth.account` | Holds password accounts, which have no tenant, and SSO identities, which do ([ADR 0010](0010-authentication-security-rules.md)). `CHECK ((tenant_id IS NULL) = (sso_provider_id IS NULL))`, and a second check allows a null tenant only on credential accounts. Its policies use `tenant_id IS NULL OR tenant_id = app.current_tenant_id()` |
| `auth.sso_provider` | One more `SELECT` policy, `TO` the owner of `auth.sso_providers_by_key_version()`, is `USING (true)`; that owner has column grants on `id`, `tenant_id` and the key version only |
| Verified SSO domains | The domain index is unique across tenants rather than per tenant (rule 6), and among verified rows only, so a verified domain belongs to one tenant at a time and a pending claim blocks nobody ([ADR 0010](0010-authentication-security-rules.md#sso)) |
| `auth.audit_event` | Not a tenant table. RLS lets `app_auth` insert and read, and lets the purge delete only expired rows |
| Other `auth` tables without `tenant_id` | No RLS; only `app_auth` and the function owners below have grants |
| `pgboss` schema, `app.job_queue` | The guarded exception to row-level security in [ADR 0009](0009-background-jobs.md) |
| `migrations` schema | Only `migrator` has rights |

### Approved definer functions

| Function | Callable by | Returns | Its owner holds (plus `USAGE` on the schemas it reads) |
| --- | --- | --- | --- |
| `app.tenant_ids()` | `app_worker` | Ids of active tenants | `SELECT (id, status)` on `app.tenant`, with the policy above |
| `app.purge_expired_audit()` | `app_worker` | A count | On both audit tables: `SELECT` on `id`, `retain_until` and any `tenant_id`, `DELETE`, and `INSERT` on every column except `occurred_at` and `retain_until`, with a `SELECT`, `DELETE` and `INSERT` policy `TO` it on each; `SELECT` on the `app.retention_policy` columns the trigger reads; `EXECUTE` on `app.current_tenant_id()` |
| `auth.session_context(token_hash)` | `app_api` | User id, active tenant, app, MFA state and expiry of a live session; nothing otherwise ([ADR 0010](0010-authentication-security-rules.md)) | `SELECT` on the columns it reads in `auth.session` and `auth.user` |
| `auth.sso_providers_by_key_version(version)` | `app_auth` | Ids and tenant ids of SSO providers whose secrets use that key version, for re-encryption, whatever the tenant's status | `SELECT` on `id`, `tenant_id` and the key version column of `auth.sso_provider`, with the policy above |

Each function's `EXECUTE` list is exactly its "Callable by" entry. A Semgrep
rule bans calling `auth.sso_providers_by_key_version()` outside the key
re-encryption command. We chose that over a login role of its own for the
command, which would add a credential and protect little, since `app_auth`
can already set any tenant through the sign-in tenant helper.

### Audit retention: the exception to rule 4

[Architecture rule 4](../ARCHITECTURE.md) makes the audit log append-only.
The retention purge is its one named exception: a single approved function
deletes only rows past a `retain_until` that the database sets itself, never
below a platform minimum that no tenant can lower, and every purge writes its
own audit event.

- `occurred_at` defaults to `now()`, and a `BEFORE INSERT` trigger sets
  `retain_until` from the tenant's audit rule in `app.retention_policy`. The
  trigger also resets `occurred_at`, so a supplied value for either column is
  ignored, and no app role's or function owner's `INSERT` grant includes
  either column.
- A `CHECK` keeps `retain_until` at least 12 months after `occurred_at`, the
  platform minimum. The tenant setting has the same floor, and only a
  migration can lower it. A changed setting applies to events written after
  the change.
- `auth.audit_event` follows the same pattern, with retention fixed at the
  12-month minimum ([ADR 0010](0010-authentication-security-rules.md)).
- `app.purge_expired_audit()` is the only thing that deletes. It takes no
  arguments. With a tenant set, it deletes that tenant's expired
  `app.audit_event` rows; with none set, expired `auth.audit_event` rows. It
  deletes in bounded batches, and writes an audit event with the count to the
  table it purged, in the same transaction.
- On both tables the only permissive `DELETE` policy is the purge owner's,
  and it matches only rows past `retain_until` (in the current tenant, for
  `app.audit_event`). So even the purge cannot remove an event still inside
  its retention period. `UPDATE` has only the restrictive `false` policy.

Erasure is not yet designed. An append-only log cannot hold a personal value
that an erasure request (E3) must remove. The leading option is to encrypt
personal values in each event's before and after data with a key per data
subject, and erase by deleting that key ("crypto-shredding"). The
alternative is to hold such values by reference in a table that erasure can
change. An ADR decides this before E3 work starts, and also covers the typed
identifiers and IP addresses that `auth.audit_event` keeps for 12 months.
Until then, tenant audit events hold ids, codes and field ids only, never
personal values.

### Tenant context and queries

- Every tenant-scoped query runs inside a helper in `packages/db`. It opens a
  transaction, asserts that `app.tenant_id` is empty, and sets it with
  `set_config('app.tenant_id', ..., true)`, so the setting ends with the
  transaction. It runs `RESET ALL` before returning the connection to the
  pool.
- The tenant id comes only from these sources, never from a body, a caller
  argument, or (outside source 4) a URL. The helper takes a typed value from
  one of the first three (a verified session, a checked job or a fan-out
  entry), never a bare uuid:
  1. the session's active tenant, which `apps/api/src/auth` sets at sign-in
     or on a switch, and which grants nothing by itself: every request checks
     the user's membership in it under RLS;
  2. a job whose tenant the database checked when it was sent
     ([ADR 0009](0009-background-jobs.md));
  3. the `app.tenant_ids()` fan-out, in the scheduler's platform job only;
  4. before sign-in, the tenant named in a sign-in or callback URL, or, in
     the key re-encryption command, a tenant that
     `auth.sso_providers_by_key_version()` returned. A separate helper that
     only `apps/api/src/auth` may import sets it, as `app_auth`, to read and
     write that tenant's SSO rows
     ([ADR 0010](0010-authentication-security-rules.md));
  5. in the audit-copy replay command, which lives only in
     `apps/api/src/auth`, the tenant recorded on the auth event it replays.
     A replay helper that only that directory may import sets it, as
     `app_api`, to write that event's copy
     ([ADR 0010](0010-authentication-security-rules.md#audit)).
- Semgrep rules ([ADR 0002](0002-licence-and-dependency-policy.md)) ban
  `sql.raw` and `sql.lit`, ban `sql.id`, `sql.ref` and `sql.table` with a
  non-literal argument, ban importing `pg` or `kysely` outside `packages/db`,
  and ban importing the sign-in tenant helper or the replay helper outside
  `apps/api/src/auth`.
- Accepted residual risk: an SQL injection that reaches `set_config` could
  change the tenant for the rest of that transaction. The Semgrep rules, the
  empty-setting assertion and `RESET ALL` keep it to one transaction.
- Constraint names and database messages never reach clients; the API maps
  violations to its own problem details ([ADR 0004](0004-api-contract.md)).

### Checks

- A catalogue test, run as each app role, fails if:
  - a table breaks RLS rule 1, 2, 3, 4 or 6 and is not a named exception;
  - a view lacks `security_invoker`, or a materialized view exists (none is
    approved);
  - a definer function is not in the table above, lacks the pinned
    `search_path`, has an `EXECUTE` list other than "Callable by", or has an
    owner that is not `NOLOGIN`, `NOSUPERUSER` and `NOBYPASSRLS`, owns
    anything else, or holds any grant or policy not listed;
  - any function, `pgboss`'s included, is executable by `PUBLIC`, or by an
    app role not listed for it in the test;
  - a role has an attribute or membership the roles table forbids, an app
    role owns an object or has `CREATE` on any schema, or `app_auth` or
    `app_queue` holds a right outside its own schema beyond those listed;
  - an app role has more than `INSERT` and `SELECT` on an audit table, or
    an app role's or function owner's `INSERT` grant covers `occurred_at` or
    `retain_until`.
- CI applies every `up`, then every `down`, then every `up` again on an empty
  database, then runs the catalogue test and the cross-tenant denial tests.

## Consequences

- Every policy and grant is plain SQL in review, and the catalogue test
  catches what review misses.
- `FORCE` applies to the migrator too, so a data migration that touches
  tenant rows runs tenant by tenant with the tenant set.
- Logical replication ignores RLS. The change feed (E10) therefore never
  publishes tables directly: it reads through the classification map and
  sends only what each field's classification allows.
- Kysely upgrades are deliberate and pinned exactly, and we read the release
  notes for each 0.x minor. Its four 2026 advisories (JSON paths, MySQL
  escaping) are fixed from 0.28.17. JSON path keys built from input get the
  same review as raw SQL.
- kysely-codegen last released in February 2026. If it stalls, kanel-kysely
  (MIT, 4.0.0, April 2026) generates the same kind of types. If Drizzle 1.0
  ships down migrations, we can revisit; migrations stay SQL either way.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| kysely | 0.29.6 | MIT | 2026-09-16 | Active; 14k stars |
| pg | 8.23.0 | MIT | 2026-08-08 | Active |
| kysely-codegen | 0.20.0 | MIT | 2026-02-16 | Slower; last commit 2026-02-16 |
| kanel-kysely (fallback) | 4.0.0 | MIT | 2026-04-01 | Repository active 2026-09-27 |
| drizzle-orm (not chosen) | 0.45.3 | Apache-2.0 | 2026-09-21 | 1.0.0-rc.4 on `rc` tag |
| drizzle-kit (not chosen) | 0.31.11 | MIT | 2026-09-21 | No down migrations |
| node-pg-migrate (not chosen) | 9.0.0 | MIT | 2026-07-17 | Active |
