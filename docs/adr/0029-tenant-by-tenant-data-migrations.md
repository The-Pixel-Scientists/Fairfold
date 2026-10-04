# ADR 0029: Tenant-by-tenant data migrations

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0003](0003-query-builder-and-migrations.md) forces row-level security on
every tenant table, and gives no role `BYPASSRLS`. `FORCE` applies to the
table owner, `migrator`, too. So a migration that rewrites tenant rows sees
none unless a tenant is set: an `UPDATE` in `up.sql`, which runs with no
tenant, matches nothing and succeeds, and the data change silently does
nothing.

ADR 0003 names the need in a consequence, "`FORCE` applies to the migrator
too, so a data migration that touches tenant rows runs tenant by tenant with
the tenant set", but gives no mechanism. Its list of the sources a tenant id
may come from ("Tenant context and queries") has no entry for a migration.
This ADR settles that conflict.

Constraints:

- Kysely's `Migrator` runs a batch of migrations in one transaction, so a
  migration cannot set a tenant per transaction.
- `withTenant()` takes a typed tenant from a known source, never a bare uuid.
- A list of tenants is a read across tenants. It must hold ids only, and
  `migrator` must gain no right on a tenant table.
- Every migration is reversible or has a documented rollback.
- No migration planned for November or December 2026 rewrites tenant rows.
  [ADR 0024](0024-no-tool-on-by-default.md)'s module default uses an audited
  operator backfill instead.

## Options considered

1. **A data step beside the migration, run tenant by tenant by a helper, as a
   role that owns nothing.** No bypass anywhere, a log of what ran where, and
   a rerun that resumes. Costs a helper, a role, a definer function and a log
   table.
2. **A migration role with `BYPASSRLS`.** Simplest, but it breaks ADR 0003's
   roles rule and its catalogue check, and puts every tenant behind one
   credential.
3. **Turn `FORCE` or the policies off for the length of a migration.** One
   statement each way, but the API keeps running during migrations, and a
   failed run could leave a table open.
4. **A definer function for each data change, owned by a role with a
   `USING (true)` policy.** Each change needs its own owner, policy and
   catalogue entry, reads every tenant in one statement, and leaves no
   per-tenant record.
5. **Operator commands only**, as ADR 0024's backfill. Right for one-off
   changes that need an audited actor, but nothing ties them to a schema
   version, so a later migration cannot rely on one having run.

## Decision

Option 1. The design is written now, and the helper is built with the first
migration that needs it.

### Schema part and data part

- A change that rewrites tenant rows comes in separate steps. Migration
  `NNNN` changes the schema only, and only adds: it never removes or tightens
  what running code relies on. Data step `NNNN` then rewrites the rows. A
  migration in a later release tightens or removes, for example adding
  `NOT NULL` or dropping the old column.
- A data step is a folder, `packages/db/data-steps/NNNN_<schema>_<description>/`,
  named after the migration it follows, holding `grants.sql` and `step.sql`
  for the step, and `undo-grants.sql` and `undo.sql` for its undo.

Ordering is enforced, not left to the job's sequence:

- The migration provider in `packages/db/scripts/` wraps the `up` of every
  migration numbered after `NNNN`, up to and including the migration that
  retires step `NNNN` (below), or every later one while none exists yet.
  Inside that migration's transaction, under Kysely's migration lock, it
  first counts the ids from `app.migration_tenant_ids()` that have no `done`
  row for the main pass of step `NNNN` in `migrations.data_step_run`. If any
  are missing, it raises an error naming the step and the remedy, "run
  `pnpm db:migrate` again", and the migration does not apply. A second
  migrate job, or a plain `migrateToLatest()`, therefore cannot pass an
  unfinished step.
- The migrate job and `pnpm db:migrate` never call a bare
  `migrateToLatest()` past a pending step. They apply migrations up to
  `NNNN`, run every data step that has not retired (which also gives a
  tenant created since the last run its pass, usually of no rows), and only
  then carry on.

Expand and contract:

- The release that adds the column also makes the new API write the new
  form. The old API keeps running during the step and until the new release
  has rolled out, so rows it writes after a tenant is marked `done` are not
  converted. `done` means only that no row matched when that tenant's pass
  ended.
- So the migration that tightens or removes names the step it depends on, in
  a `final-pass` file in its folder holding the step's name. Before applying
  it, the migrate job runs a final pass of that step for every tenant,
  ignoring `done`, until no rows change, and logs it as pass `final`. The
  provider refuses the tightening migration unless every tenant has a `done`
  row for the final pass. By then only the new API runs, so no straggler can
  appear after it. This matters most for a step that moves personal data to
  a protected form, where a straggler would keep the old form unnoticed.

Retirement:

- A step retires when the migration whose `final-pass` file names it is
  applied, which Kysely's history records. From then on the helper never
  runs the step, the migrate job skips it, and the provider no longer checks
  it, so the gate on step `NNNN` covers only the migrations after `NNNN` up
  to and including that tightening migration. Without this, a tenant created
  after the tightening would get a pass of a step whose `grants.sql` or
  `step.sql` names a column that no longer exists, the pass would fail, and
  every later migration would be refused until someone edited the log by
  hand.
- A tenant created after a step retires needs no pass: by then only the API
  that writes the new form runs, so it has no rows in the old form.
- Review requires every data step to retire in the next release. Where
  nothing needs tightening, a migration that holds only the `final-pass` file
  and a comment-only `up.sql` and `down.sql` retires it, so no step keeps
  running, and logging, for every new tenant without end.
- Rolling back the tightening migration brings the step back: it is checked
  and run again, and that migration applies again only after a fresh final
  pass.

### The helper

The helper is `packages/db/scripts/data-steps.ts`. Only migration tooling
imports it: the migrate job, `pnpm db:migrate` and `pnpm db:rollback`. A
Semgrep rule bans importing it, or calling `app.migration_tenant_ids()`,
anywhere else.

A run of one step:

1. The helper takes the lock the migrator takes, as a session-level advisory
   lock, so no migration and no other run can start until it ends. It then
   refuses a step that has retired.
2. As `migrator`, in a transaction of its own, it revokes every table right
   from `migrator_data`, runs `grants.sql` (or `undo-grants.sql` for an
   undo), then checks the rights it granted and plans the step's statement,
   as described below. If a check fails, it revokes everything again and
   stops before any tenant is touched.
3. It lists tenants with `app.migration_tenant_ids()`.
4. For each tenant without a `done` row for this pass, it opens a transaction
   with `withTenant()`, which asserts no tenant is set and sets this one
   transaction-locally. It runs `SET LOCAL ROLE migrator_data`, sets a lock
   timeout of 2 seconds and a statement timeout of 60 seconds, and runs
   `step.sql` once. If more than 1,000 rows changed, it rolls back and fails.
   Otherwise it resets the role, updates the tenant's log row in the same
   transaction and commits. It repeats until a run changes no rows, then
   marks the tenant `done`.
5. It lists tenants again, so a tenant created during the run gets the step
   too. When every tenant listed is done, it revokes every table right from
   `migrator_data` and releases the lock. A forward run and an undo run are
   separate runs, so the rights granted for one never remain for the other.

Decided: one transaction per bounded batch of at most 1,000 rows within a
tenant, rather than one per tenant. A large tenant then never holds locks
that stall requests for long, and a crash loses at most one batch.

`step.sql` rules:

- It is one `INSERT` or `UPDATE` statement. A data step changes how data is
  held, never removes it; removal falls under erasure and retention.
- It is idempotent: it changes only rows it has not yet changed, for example
  `WHERE new_column IS NULL`, and carries its own `LIMIT` of 1,000, so a rerun
  is safe and the loop ends.
- The helper sends it through the extended query protocol, which accepts one
  statement only. Before the first tenant, it runs `EXPLAIN (FORMAT JSON)` on
  it as `migrator_data`, which plans without executing, and refuses unless
  the plan holds exactly one `ModifyTable` node and its operation is `Insert`
  or `Update` (`Delete` only in `undo.sql`). So "one `INSERT` or `UPDATE`"
  cannot hide a data-modifying `WITH` clause, a `MERGE` or a second
  statement.
- After the statement runs, the helper checks that `current_user` is still
  `migrator_data` and that `app.tenant_id` is still the tenant it set, and
  rolls back and fails if not.

These checks catch a mistake. The guard against intent is review, since
anyone who can change a migration can already act as `migrator`.

### What a step may reach

`grants.sql` runs as `migrator`, which owns every table, so the helper checks
both the file and its effect:

- Every statement in `grants.sql` must have the form
  `GRANT <privileges> ON <schema>.<table> TO migrator_data`, where the
  privileges are `SELECT`, `INSERT` or `UPDATE`, each with or without a
  column list. `undo-grants.sql` may also grant `DELETE`. The helper refuses
  any other statement, and `DELETE` in `grants.sql`, before running either
  file.
- After the file runs, the helper reads `migrator_data`'s rights from the
  catalogue. It refuses unless every table it holds a right on is a tenant
  table under ADR 0003's rules: it has `tenant_id`, row-level security is
  enabled and forced, every granted command has a permissive policy that
  applies to `migrator_data`, and every permissive policy that applies to it
  has `tenant_id = app.current_tenant_id()` as a top-level `AND` term. The
  helper uses the same check as the catalogue test. It also refuses any
  right on a sequence, function or schema beyond `migrator_data`'s standing
  ones.
- Never allowed, whatever their policies: the audit tables
  (`app.audit_event`, `auth.audit_event`), every table in the `auth`,
  `pgboss` and `migrations` schemas, `app.job_queue`, `app.tenant`,
  `app.request_limit` and `app.idempotency_key`
  ([ADR 0028](0028-idempotency-keys.md)). A data step cannot write an audit
  event, touch a store that has no tenant policy, or rewrite keys that
  decide replays.

### Where the tenant list comes from

- A new approved definer function, `app.migration_tenant_ids()`, returns the
  id of every tenant, whatever its status. A data change must reach suspended
  tenants too, or a later tightening migration would fail on their rows.
  `app.tenant_ids()` returns active tenants only and stays the worker's.
- Only `migrator` may execute it. Its owner, `owner_app_migration_tenant_ids`,
  is `NOLOGIN` and holds `SELECT (id)` on `app.tenant`, with a `SELECT` policy
  `TO` it that is `USING (true)`. A migration hands the function to its owner
  as [ADR 0023](0023-function-owner-memberships.md) describes.
- `migrator` gains `EXECUTE` on this function, and no right on any tenant
  table.
- ADR 0003's list of tenant sources gains a seventh
  ([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md) added the
  sixth): in a data step run, a tenant that `app.migration_tenant_ids()`
  returned. The helper, which only migration tooling imports, marks it with
  `trustedTenantId()` and sets it with `withTenant()` as `migrator`, which
  then runs the step as `migrator_data`. This is the fourth source that
  `withTenant()` takes as a typed value, after a session, a checked job and
  the worker's fan-out.

### No bypass

- No role gains `BYPASSRLS`, no policy is disabled or dropped, `FORCE` stays
  on, and a step runs no DDL.
- The step never runs as a table owner. `migrator_data` is `NOLOGIN`,
  `NOSUPERUSER` and `NOBYPASSRLS`, and owns nothing. `migrator` is its member
  with `SET TRUE, INHERIT FALSE, ADMIN FALSE`, as with the function owners in
  ADR 0023. It always holds `USAGE` on the application schemas and `EXECUTE`
  on `app.current_tenant_id()`, which the policies call, and holds table
  rights only during a run, from `grants.sql` or `undo-grants.sql`. Not being
  an owner, it cannot alter a table, change a policy or turn row-level
  security off, even by mistake.
- It reaches only the tenant set because, and only while, every table it
  holds a right on is a tenant table with forced row-level security whose
  permissive policies that apply to it all carry the tenant term. The
  helper's check under "What a step may reach" makes that a condition of
  every run rather than an assumption.
- The catalogue test proves it. It fails if `migrator_data` or the new owner
  lacks the attributes above, if `migrator_data` owns any object or holds any
  right beyond its standing ones (the test runs outside a run, so table
  rights left behind fail it), if any role has `BYPASSRLS`, or if any tenant
  table lacks `ENABLE`, `FORCE` or a policy. The migrate job also revokes any
  rights left behind when it starts.
- A database test, as `migrator_data` with a tenant set, shows that
  `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` fails and that another
  tenant's rows are invisible.
- Helper tests show that a run stops before any tenant, with no right left
  behind, when `grants.sql` grants on a table on the never-allowed list or
  on one without forced row-level security, grants `DELETE`, or holds any
  other statement, and when `step.sql` hides a `DELETE` in a `WITH` clause.
  A provider test shows that a migration after an unfinished step, or a
  tightening migration before its final pass, does not apply. Another
  creates a tenant after the tightening migration, adds one more migration,
  and shows that it applies, that the retired step does not run for the new
  tenant, and that the step's log rows are gone.

### Logging

Decided: a table, `migrations.data_step_run`, beside Kysely's history.

- One row per step, pass and tenant: the step name, a `pass` checked to
  `main` or `final`, `tenant_id` (a foreign key to `app.tenant`, deleted with
  the tenant), rows changed, batches run, `started_at`, `finished_at`, an
  `outcome` checked to `running`, `done`, `failed` or `undone`, and an error
  code, a SQLSTATE only. The primary key is `(step, pass, tenant_id)`.
- Only `migrator` has rights in the `migrations` schema, under ADR 0003's
  existing exception. The catalogue test's reason for that exception names
  this table.
- The run prints counts and codes only.
- Decided: a retired step's rows are deleted by the provider in the
  transaction that applies the tightening migration, so the table holds rows
  only for steps still in force and stays small. Nothing is lost that
  matters: Kysely's history records that migration, which could apply only
  once every tenant had a `done` final pass, and the deploy log keeps the
  run's counts.
- A data step writes no audit event. It changes how data is held, not what
  it means: no state change, decision, permission, module switch or
  configuration. It runs the same reviewed SQL for every tenant, as a schema
  migration does, and has no person to name as its actor. A change to what a
  record means is an operator command that audits each tenant, like ADR
  0024's backfill, and review refuses a data step that would need an audit
  event.

### Failure and rerun

- A failed batch rolls back on its own. The tenant's log row records `failed`
  with the SQLSTATE, and the run stops.
- A rerun skips tenants that are `done` for that pass and carries on with
  the failed tenant from the rows not yet changed. Rows the old API writes
  after that are caught by the final pass, not by the rerun.
- The migrate job exits with an error, and the provider refuses every later
  migration, up to the one that retires the step, until the step is done, so
  the deploy stops before the new API rolls out.

### Rollback

- `undo.sql` reverses the step under the same rules, run tenant by tenant by
  the same helper, and records `undone`. Where the step inserted rows, its
  undo is the one kind of data step that may be a `DELETE`, and only of those
  rows, with `DELETE` granted in `undo-grants.sql` for the undo run alone.
  Locally, `pnpm db:rollback` undoes a data step before it rolls
  back the migration the step follows.
- A retired step is undone only after the migration that retired it has
  been rolled back, which `pnpm db:rollback` does first, since it goes in
  reverse order.
- Where old values cannot come back, `undo.sql` raises an error naming the
  documented rollback, such as a restore, as `down.sql` does under ADR 0003.
- In production the release runbook names each step's undo or restore.

### Timing

No migration in November or December 2026 rewrites tenant rows: ADR 0024's
module default uses the audited operator backfill. The helper,
`app.migration_tenant_ids()`, its owner, `migrator_data` and the log table are
built with the first migration that needs them, once this ADR is accepted.
Until then, review refuses any migration whose `up.sql` or `down.sql` writes
tenant rows, since it would change nothing and still succeed.

## Consequences

- When accepted, this amends ADR 0003. Its roles section gains
  `migrator_data` and `owner_app_migration_tenant_ids`, and the roles script
  a new version. Its approved definer functions gain a row, its tenant
  sources a seventh entry, its migrations section the provider's refusal to
  pass an unfinished step and the rule that retires a step, and its
  consequence on `FORCE` and the migrator points here. It also amends ADR
  0023's "one membership" rule, which gains `migrator`'s membership in
  `migrator_data`. Both stay untouched until then.
- A change to tenant rows spans two releases: one that adds the column, makes
  the API write it and fills it, and a later one that runs the final pass,
  then tightens and retires the step.
- A large step makes the migrate job run longer. The runbook times each step
  on staging first.
- Self-hosters run the same steps with the same migrate job.

## Dependency check

No dependency is added. The helper uses Kysely and pg, which ADR 0003 already
approved.
