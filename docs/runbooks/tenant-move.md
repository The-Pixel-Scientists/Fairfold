# Move a tenant to another cell

Use this page when a funder asks to move from one cell (one jurisdiction's
deployment) to another, for example from the London cell to a future EU cell.
It applies in every hosting phase. The rule behind it is in
[ADR 0012](../adr/0012-hosting-targets-and-cells.md).

**A move is an export and an import. It is never replication.** The tenant's
backups, logs, email relay and telemetry stay in the jurisdiction where they
were made until they expire on their own tiers. The funder has to be told this.

| | |
| --- | --- |
| **Who may run it** | Two operators: one runs the steps and one checks counts and signs each stage off. The funder's named administrator agrees the freeze window. |
| **What you need** | The funder's written instruction; the data processing agreement for the target cell; access to both cells; an isolated scratch server; time for a freeze of at least a few hours (agree it with the funder); a rehearsal on synthetic data first. |
| **What usually starts it** | A written request from the funder. There is no alert for it. |

**Status on 9 November 2026.** There is no tenant export command, no import
command, no way to suspend a tenant from the operator's side, and no way to
retire one. This page describes a careful manual procedure and marks every
missing tool with **no command yet**, so you can find them with a search. Do
not run a move on live data until the lead has built the missing pieces or
accepted the by-hand route in writing. The one operator command that exists for
the target side is `pnpm tenant:create`.

## Rules the move must not break

- Never use `BYPASSRLS` for the import and never turn row-level security off.
  Row-level security is forced on every tenant table, including for the table
  owner, so an import writes each table with the tenant set, tenant by tenant,
  the model in [ADR 0029](../adr/0029-tenant-by-tenant-data-migrations.md).
  That ADR's helper is not built. How an import respects forced policies
  without it is the main gap (see step 6).
- The backup role reads every tenant. Use it for the nightly dump only. Do not
  use it to run an import or any application traffic.
- Audit rows are copied as they are, never edited or deleted.
- Unreleased decisions stay unreleased. The import must not notify anyone, and
  the worker stays off in the target until the funder's data is checked.
- Rehearse with synthetic data only.

## Before you start

1. **Get the instruction in writing** from the funder's named administrator,
   with the target cell, and keep it.
2. **Check the data processing agreement** covers the target cell. If it does
   not, stop.
3. **Agree the freeze window** with the funder, in UK time, and tell them
   what applicants and staff will see.
4. **Check both cells run the same release and migration version.** In each
   cell, `node packages/db/scripts/db.ts up` ends with "No pending migrations."
   after the same release is deployed. If they differ, upgrade the older cell
   first. A mismatch will lose columns.
5. **Check which modules the tenant uses** (the console's modules page, or the
   tenant's rows in the modules table). You need the same list on the target.
6. **Rehearse** the whole move once with a synthetic tenant and record the time
   each step took.

## Move the tenant

1. **Freeze the tenant.** No writes may happen from now until the tenant is
   unfrozen. **No command yet:** there is no operator command to suspend a
   tenant (the tenant has an `active` or `suspended` status, but only the
   database owner can change it). Interim: ask the funder to stop all staff and
   applicant activity for the window, remove the tenant's address at the proxy
   so requests get a maintenance page, and stop the worker in the source cell
   for the window. Success: the audit log for the tenant shows no new events
   over a few minutes.
2. **Take a frozen copy.** Make a copy of the source database after the freeze:
   a point-in-time clone (managed service: a Cloud SQL clone; self-hosted: a base
   backup replay to a target time after the freeze) in an isolated scratch
   environment. Do not read the live database for the export. The scratch
   environment counts as production for access: only the two operators reach it,
   it has no route out except to the target cell's import host, and it is
   destroyed with its disks by the end of the next working day.
3. **Export every table's rows for this tenant.** The tenant's rows are in every
   schema that has a `tenant_id` column. List them with:

   ```sql
   SELECT c.oid::regclass
     FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE c.relkind = 'r' ORDER BY 1;
   ```

   For each table, run `COPY (SELECT * FROM <table> WHERE tenant_id = '<tenant-id>')
   TO STDOUT` as the superuser of the scratch server, and keep the row count.
   **No command yet:** there is no tenant export command. The list includes
   every module's tables (the party core and each module the tenant uses),
   and `auth.sso_provider`, `auth.sso_domain` and the tenant's memberships.
   The people (`auth.user` rows and their credentials) are shared across tenants
   and are not selected by `tenant_id`: how a person's sign-in moves is a gap
   for the lead. Do not copy the background job tables (`pgboss`): jobs are
   re-created in the target, not moved.
4. **Export the files.** Copy every object under `clean/<tenant-id>/` from the
   source storage bucket, with its hash from `app.file.sha256`, to the scratch
   server. **No command yet.** Never copy `withheld/`. Success: the object
   count equals the count of the tenant's `app.file` rows with a clean scan state,
   and each object's SHA-256 equals its row's `sha256`.
5. **Create the tenant on the target.** In the target cell, as the operator:

   ```
   pnpm tenant:create --slug <tenant-slug> --name "<tenant-name>" --admin-email <admin-email> --modules <module-ids>
   ```

   Use the same slug and the same module list. It makes the tenant and invites
   the first administrator, as `app_operator` for the tool switches and
   `app_worker` for the invitation, and the tenant creation and its switch-on
   write audit events. If the invitation cannot be sent, the tenant still
   exists, and the command says so. Success: it prints the tenant's id and slug.
   The id is new: you will remap `tenant_id` on import (see below).
6. **Import the data.** Load each exported table into the
   target for the new tenant id, with the new tenant set, table by table in
   dependency order (a table after the tables it references). **No command yet:**
   there is no import command, and ADR 0029's helper is not built. The
   database rules mean this works only where `migrator` has an insert policy
   on the table, and many tables give insert only to the application role that
   owns that data, which is deliberate. The lead must decide the route before
   a live move: one approved import function per ADR 0003, run as `migrator`,
   which sets the tenant and writes an audit event. Until then, do not
   improvise with `BYPASSRLS` or a superuser, which would break rules 2 and 4.
   Rewrite ids only if you must: row ids, ledger ids and audit event ids should
   keep their values, because rows refer to each other.
7. **Import the files** into the target bucket under `clean/<new-tenant-id>/<file-id>`
   and update each `app.file.storage_key` to match. **No command yet.**
8. **Re-apply the erasure ledger for this tenant.** Copy its `app.erasure_ledger`
   rows first (they are in the export). Then, in the target cell, the restore steps
   for re-applying the ledger for one tenant apply, with the cell in restore
   mode as described in
   [Restore the service from a backup](restore.md#re-apply-the-erasure-ledger).
   Success: `app.reapply_erasure_ledger()` for the tenant reports entries seen
   equal to the tenant's ledger rows, and writes
   `platform.erasure_ledger.reapplied`.
9. **Re-verify SSO domains in the target.** DNS tokens belong to a tenant and a
   cell, so the old tokens prove nothing. The funder's administrator signs in,
   goes to Settings, then Single sign-on, and for each domain publishes the new
   record and chooses **Verify domain**. If a domain was held in the source cell,
   the cells do not know each other, so there is no conflict between them.
   Provider secrets are encrypted with each cell's own auth secret, so the
   administrator re-enters them. **No command yet** to carry them across.
10. **Check the result.** A second operator checks:
    - row counts per table against the export;
    - file counts and hashes against the export;
    - a sign-in as the funder's administrator, and as a user of another tenant
      in the target cell, who sees none of this funder's data;
    - the catalogue test passes in the target (`pnpm test:db`, which includes `packages/db/test/catalogue`)
      and no application role has `BYPASSRLS`;
    - audit events exist for the import steps.
11. **Switch the tenant's address.** Update DNS (a custom domain, see
    [ADR 0035](../adr/0035-embeds-and-custom-domains.md)) or tell the funder its new
    address, in the funder's time zone. **No command yet** to automate it.
12. **Unfreeze.** Start the worker in the target. Tell the funder the window is
    over. Success: staff sign in in the target and a test application saves.
13. **Retire the tenant in the source cell** under its retention rules.
    **No command yet:** there is no tenant retirement command. Until there is,
    keep the source tenant suspended (**no command yet** for that too) and leave
    its data in place until the funder agrees in writing, and remember the
    source cell's backups stay in that jurisdiction until they expire.
14. **Destroy the scratch environment** by the end of the next working day and
    record when.

## If a step fails

- Before step 11, the source cell is unchanged and still the funder's live
  service. Unfreeze it and tell the funder. Delete the target tenant's partial
  data only through an approved route; **no command yet** to remove a tenant.
- After step 11, switch the address back to the source, unfreeze the source, and
  agree with the funder what to do with the changes made in the target.

## What the move leaves behind

The source cell's backups, logs, email relay records and telemetry stay where
they are and expire on their own tiers: 35 days for daily backups, 12 months
for monthly, 7 years for yearly. Say this to the funder in writing, and make
sure the target cell's processing agreement names the target cell's providers.
