# ADR 0009: Background jobs

- **Status:** proposed
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

V1 needs work outside the request cycle: release emails, reminders for
unsubmitted drafts and overdue reviews, virus scans, exports, the change feed
and the nightly retention sweep. The [technical
baseline](../V1-PLAN.md#technical-baseline) names pg-boss so there is no
extra infrastructure to host. Constraints:

- Only the migrator changes the schema, and the app roles have no `CREATE`
  and no `BYPASSRLS` ([ADR 0003](0003-query-builder-and-migrations.md)).
- Every read and write of tenant data, including by jobs, happens inside a
  tenant context under RLS.
- Job payloads are stored in Postgres, so they need a classification and a
  retention rule.
- No code path may reject, award or pay without a named person's action
  ([architecture rule 9](../ARCHITECTURE.md)).
- Some jobs, such as exports, act for a user after the authorising request
  has ended, when that user's rights may have changed.

## Options considered

1. **pg-boss.**
   - Pros: Postgres only. Retries with backoff, dead-letter queues, singleton
     keys and cron schedules. `migrate: false` stops it changing its own
     schema, and it exports the SQL to build, upgrade and roll back that schema
     (`getConstructionPlans`, `getMigrationPlans`, `getRollbackPlans`), which
     fits our migrations. `fromKysely(trx)` sends a job inside our own
     transaction. Very active.
   - Cons: fast-moving (ten releases between 16 and 26 September 2026), and
     schema changes between versions need a migration from us. Its tables
     have no `tenant_id` or RLS.
2. **Graphile Worker.**
   - Pros: low latency through LISTEN and NOTIFY. An `add_job` SQL function
     works inside transactions and triggers. Cron support.
   - Cons: still 0.x. It installs and migrates its own schema at start-up, so
     we would have to run that step under the migrator role ourselves.
3. **BullMQ.**
   - Pros: mature and feature-rich.
   - Cons: needs Redis or Valkey, the extra infrastructure the plan rules out.

## Decision

Aaron has chosen pg-boss (option 1), pinned exactly at 12.33.2, with a
guarded exception to the row-level security rule.

### The exception

The worker must fetch jobs for every tenant, so pg-boss's tables cannot carry
tenant RLS. The `pgboss` schema and the queue register `app.job_queue` are the
one named exception to [architecture rule 2](../ARCHITECTURE.md), and only
while these guards hold: payloads hold ids only, the tenant id comes from the
transaction and is checked by the database, the API and worker use separate
roles, errors are stored as codes only, and every job column is classified.
If a guard is removed, the exception lapses until a new ADR replaces it.

### Schema, queues and roles

- A migration creates the `pgboss` schema as the migrator. Its `up.sql` is
  the output of `getConstructionPlans('pgboss')` for the pinned version
  (schema version 42), and its `down.sql` drops the schema. An upgrade that
  changes the schema version ships a migration built from
  `getMigrationPlans` (up) and `getRollbackPlans` (down).
- Queues are created in migrations, because creating a queue creates its own
  job table. The same migration registers the queue in `app.job_queue` with a
  kind, `tenant` or `platform`, and grants on its table. A queue's
  dead-letter queue has the same kind.
- Some upgrades queue schema commands in pg-boss's `bam` table, which only an
  instance with `migrate: true` runs, so the migrate job drains them as the
  migrator before it exits.
- The API and worker run pg-boss with `migrate: false` and
  `createSchema: false`. `start()` throws if the schema is behind, and a test
  relies on that to catch a forgotten migration.
- Roles ([ADR 0003](0003-query-builder-and-migrations.md#roles)), each granted
  table by table:
  - `app_api`, and `app_worker` for handlers, only send. On every job table
    each has column-level `INSERT` on exactly the columns pg-boss's send
    writes, which leaves out `state`, the `source_*` columns, `output`,
    `started_on`, `completed_on` and `retry_count`, and `SELECT` on `id`
    only: no `UPDATE` and no `DELETE`. Their few other grants are the reads
    that sending needs, listed in the migration.
  - `app_queue` is pg-boss's own connection in the worker. It fetches,
    completes, fails and retries jobs, runs maintenance and inserts scheduled
    jobs, with the rights that needs and none on tenant tables. Handlers never
    use it.
  - No app role may execute `create_queue`, `delete_queue` or the
    `job_table_*` functions; `job_now()` is granted by name. All three can
    read `app.job_queue`.
  - The catalogue test checks these grants on every job table.
- Only `packages/db` imports pg-boss. It holds the send helper and the
  handler wrapper.

### Payloads, results and classification

- Every queue has a strict Zod payload schema, checked on send and in the
  handler. Its leaves are only uuid, enum, integer or timestamp, so there is
  nowhere to put a name, email address, answer or free text. A test walks
  every queue schema and fails on any other leaf.
- Payloads carry the tenant id, entity ids, the request id, and the id of the
  user whose action caused the job. That user id is for the audit trail, never
  for permission checks.
- The wrapper catches every error, logs it through the redacting logger, and
  fails the job with only an error code and the request id. `output` never
  holds a message, a stack trace or data.
- Every column of every `pgboss` table is in the classification map with a
  retention rule: `job` and its per-queue tables, dead-letter provenance (the
  `source_*` columns), `schedule` (including `data` and `options`),
  `warning`, `bam` and `queue_stats`. Completed, failed and dead-lettered jobs
  are deleted after 7 days.

### Tenant checks

A `BEFORE INSERT OR UPDATE` row trigger on `pgboss.job`, which PostgreSQL
applies to every queue's table, enforces the rules below. It refuses any
`INSERT` that matches none of rules 2 to 5.

1. The queue is registered in `app.job_queue`.
2. A new job (state `created`, no `source_id`) on a tenant queue carries a
   `tenantId` that `IS NOT DISTINCT FROM` `app.current_tenant_id()`, and the
   current tenant is not null.
3. A new job on a platform queue carries no `tenantId`, and comes only from
   `app_queue`.
4. pg-boss fails or retries a job by deleting its row and inserting it again.
   Such a row (state `retry` or `failed`) comes only from `app_queue`, with
   `app.current_tenant_id() IS NULL`, and on a tenant queue it still carries
   a `tenantId`.
5. A dead-letter copy (a row with `source_id`) comes only from `app_queue`,
   with `app.current_tenant_id() IS NULL`, and only if its source job exists,
   has failed and has identical `data`, and its queue's kind matches the
   source queue's.
6. An `UPDATE` cannot change `data`, `name` or `singleton_key`.

- The trigger function stays `VOLATILE`, so each of its queries takes a fresh
  snapshot.
- The database cannot tell a scheduled send from any other send by
  `app_queue`. A Semgrep rule therefore allows pg-boss's send methods only in
  the send helper, which always sends through the caller's transaction, so
  the worker's own pg-boss instance sends nothing but its schedules.
- Each rule has a test that breaks it. Inserting a job in state `active`,
  `completed`, `cancelled`, `retry` or `failed` is refused, one test per
  state. These tests run as a throwaway test role with `INSERT` on every
  column, so they exercise the trigger's refusal, not only `app_api`'s
  column grant. `app_queue` inserting one in `active`, `completed` or
  `cancelled` is refused too.
- Two more tests create a queue in a later migration and check the trigger
  fires on its jobs, and run a job until its retries are exhausted and check
  it reaches its dead-letter queue. The second also shows the trigger can see
  the failed source job. If it fails, for example after an upgrade, rule 5 is
  never loosened to make it pass.
- The worker sets tenants from payloads, so it is trusted with every tenant,
  and rule 4 cannot check which tenant a re-inserted job belongs to. What the
  database does stop is the API, or any send made inside a tenant context,
  naming another tenant.
- The send helper takes no tenant argument. It reads the tenant from the
  current transaction and puts it in the payload.
- Singleton keys include the tenant id, so one tenant's job never suppresses
  another's.
- The wrapper opens a transaction as `app_worker`, sets the tenant from the
  payload with the same helper the API uses, and hands the handler that
  transaction. Handlers have no other way to reach the database.
- Handlers re-check their preconditions in the database rather than trusting
  the payload. For example, the release email checks the decision's
  `released_at` and its release audit event before sending.

### Jobs that act for a user

- The API authorises the request under the session, then writes a
  `job_request` row in a tenant table: the requester, the permission used, the
  filters, and the field list after blind-review and classification
  filtering. Writing it is audited.
- The payload carries only that row's id and the tenant id.
- The handler checks that the requester is still an active member holding
  the permission. It then applies the stored filters intersected with the
  requester's current resource scope, from the policy module in
  [ADR 0004](0004-api-contract.md), and the stored field list intersected
  with one recomputed for their current role and blind-review settings. If a
  check fails, the job ends with an error code and an audit event, and
  produces nothing.
- The output is classified as its most sensitive field, and deleted 7 days
  after it is made. Only the requester can download it, after the same
  checks, and every download is audited.
- Exports (E10) and subject access requests (E3) are the first users.

### Processes and scheduling

- The API only sends jobs (`supervise: false`, `schedule: false`). A worker
  process, from the same image with a different command, runs handlers,
  maintenance and cron schedules. Compose gains a `worker` service but no new
  kind of infrastructure.
- Work across tenants is a scheduled platform job. It lists tenants through
  `app.tenant_ids()`, which returns ids only, and sends one job per tenant
  from inside that tenant's context. No handler touches tenant data outside a
  tenant context.
- Audit retention calls `app.purge_expired_audit()` in each per-tenant job,
  and once in a platform job with no tenant set, for `auth.audit_event`
  ([ADR 0003](0003-query-builder-and-migrations.md#audit-retention-the-exception-to-rule-4)).
- A state change and its jobs commit together: releasing decisions and
  queuing the release emails happen in one transaction through
  `fromKysely(trx)`. The job only sends; the human action is the release.
- Delivery is at least once, so handlers are idempotent.
- Audit events written by jobs record a system actor, the job id and the
  originating user.

## Consequences

- Cross-tenant tests prove that a job for tenant A cannot read tenant B's
  rows, and that a job for tenant B cannot be sent from tenant A's context.
- Upgrading pg-boss is a migration pull request with line-by-line review, not
  just a version bump, and the trigger's tests run against the new fail and
  retry SQL. 12.35.0 moves the schema to version 43 and stops a worker whose
  claim lapsed from settling the retried attempt; we take it in the first
  monthly update once it is 7 days old.
- pg-boss's redrive, which moves dead-letter jobs back as new jobs with no
  tenant set, fails the trigger's rule 2 and is not used. A runbook re-sends
  a dead-lettered job from inside its tenant's context.
- Job failures and queue depth feed the E12 dashboards and alerts.
- Self-hosters run one more container from the same image.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| pg-boss | 12.33.2 | MIT | 2026-09-18 | Very active; 4k stars; Node.js 22.12+; 12.35.0 is too new |
| graphile-worker (not chosen) | 0.18.0 | MIT | 2026-09-08 | Active; pre-1.0 |
| bullmq (not chosen) | 6.3.9 | MIT | 2026-09-25 | Active; needs Redis |
