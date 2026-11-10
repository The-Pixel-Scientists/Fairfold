# Restore the service from a backup

Use this page to bring the service back after data loss: a bad change, the
loss of the London region, or the loss of the Google account. It covers both
the managed service and a self-hosted install. The decisions behind it are in
[ADR 0011](../adr/0011-backups-and-recovery.md) and
[ADR 0027](../adr/0027-erasure-across-modules-and-audit.md).

**Status on 9 November 2026.** The off-site backup job exists. The restore
command that ADR 0011 describes does not. Where a step needs it, the step says
**no command yet** and gives the by-hand route that the merged database
functions allow. Steps that wait for a Google staging project or a PeaSoup
account say **Waits for staging** or **Waits for PeaSoup**. Until a rehearsal
has run on those, the recovery times below are targets, not measurements, and
no live personal data should be held.

| | |
| --- | --- |
| **Who may run it** | Two named operators: one runs the steps, one watches and signs the restore record. Only operators on the escrow record may recover a private key. |
| **What you need** | The Google Cloud console or `gcloud` (managed service); `pg_restore` and `psql` at PostgreSQL 16 or newer; `age`; an S3 command-line client; the escrowed private key and auth secret; access to the backup store; a clean server. Allow 4 hours for an in-region restore and a working day for an off-site restore. |
| **What usually starts it** | A page for corruption or a bad change; the loss of a region or account; the alert for a missed backup run (no run record for 26 hours) starts the check in [Check the last backup](#check-the-last-backup), not a restore. |

## Rules a restore must not break

- Row-level security stays forced on every tenant table. No application role
  gains `BYPASSRLS`. Only the backup role has it, and you use it for the
  nightly dump and nothing else. Never restore with `pg_dump --enable-row-security`
  or by turning row-level security off.
- Never edit or delete audit rows. Recovery writes its own events.
- Unreleased decisions stay unreleased. No email is sent again except by a
  named staff action.
- Rehearse with synthetic data only. A restore of real data counts as
  production for access, and its environment is destroyed by the end of the
  next working day.

## Choose a path

| What happened | Path | Data lost | Back within |
| --- | --- | --- | --- |
| Bad change or corruption in the last 7 days | [Point-in-time restore](#restore-to-a-point-in-time) (Google: Cloud SQL point-in-time recovery) | Minutes | 4 hours |
| Bad change found 8 to 35 days later | [Point-in-time restore](#restore-to-a-point-in-time), using an automated backup | Up to a day | 4 hours |
| Loss of the London region, the Google account or the production project | [Off-site restore](#restore-from-the-off-site-snapshot) from PeaSoup | Up to 24 hours | About a day |
| PeaSoup is unavailable and you need a monthly or yearly snapshot | [Off-site restore](#restore-from-the-off-site-snapshot) from the Google archive in the separate backup project | Up to a month or a year | About a day |
| Self-hosted install | Your own base backup and write-ahead log, or the nightly dump, with the steps below | What your backups hold | Yours to set |

Daily snapshots are kept for 35 days, monthly for 12 months and yearly for
7 years. The key snapshot is kept for 35 days only, whatever the tier, so a
restore from a monthly or yearly snapshot has no keys from its own date: it
uses the newest key snapshot, and re-applying the erasure ledger does the rest.

## Before any restore

1. **Export the erasure ledger from the live database, if it can still be read.**
   Restoring to a point earlier than the latest loses every erasure made after
   that point unless you do. Connect with the credential your install uses for
   operators and run, for each tenant:

   ```sql
   SELECT set_config('app.tenant_id', '<tenant-id>', false);
   COPY (SELECT id, subject_party_id, kind, subject_key_id, audit_event_id, erased_at
         FROM app.erasure_ledger ORDER BY erased_at) TO STDOUT WITH CSV HEADER;
   ```

   You must be a role that can read the table: `migrator` (the table owner)
   reads it only with a tenant set. Save each file in a protected place on the
   restore host. It holds ids and times only. **No command yet:** there is no
   command that lists every tenant and exports their ledgers together.
   Success: one file per tenant, and the row count of each matches
   `SELECT count(*) FROM app.erasure_ledger` for that tenant.
2. **Stop the API, the worker, the backup job and any scheduler**, and hold
   them at zero instances. On the managed service, set Cloud Run's instances to
   zero. On a self-hosted stack, `docker compose stop api worker`. Success:
   nothing is serving and nothing connects to the database.
3. **Write down the time the restore starts** and the names of both operators.
   **No command yet:** the restore command that writes the start of the
   restore record, outside the database, does not exist. Keep the notes in the
   escrow record's access log until it does.

## Check the last backup

When the missed-run alert fires, read the newest run record in the backup
store's `runs/` prefix. It is plain and holds a run id, an outcome code, the
tier and counts. Outcome `ok` or `already_complete` means the night is done.
Any other code names the cause: for example `bucket_lock_missing`,
`role_not_exempt` or `dump_failed`. The full list is in
[the backup job's README](../../infra/backup/README.md). Fix the cause and run
the job again before the day ends in UTC, so a first-of-the-month or
1 January snapshot is not lost to a later tier.

## Restore to a point in time

Use this for a fault inside the region. **Waits for staging:** Cloud SQL's
point-in-time recovery has not been run in this project.

1. **Choose the target time in UTC**, just before the fault, for example
   `2026-12-01T09:14:00Z`. Write down why you chose it.
2. **Restore to a new instance, never over the live one.**
   - Managed service (Google): in Cloud SQL, clone the instance to a point in
     time as a new instance. With `gcloud`:
     `gcloud sql instances clone <source-instance> <new-instance> --point-in-time <target-time-utc>`.
   - Self-hosted: restore your base backup to a new server and replay the
     write-ahead log to the target time with `recovery_target_time`. If you
     keep only dumps, create a new server and use
     [the off-site steps](#restore-from-the-off-site-snapshot) from step 5.
   Success: the new instance accepts a connection and shows data from the
   target time.
3. **Run the roles script on the new instance**, before anything connects.
   It sets the passwords and checks every role. Use the mode the target needs:
   `TPS_DB_ADMIN_MODE=managed` (with `TPS_DB_SUPERUSER` set to the admin role)
   on a managed database, the default on a server where you are the superuser.
   Run `node packages/db/scripts/db.ts prepare` with the database settings for
   the new instance. Success: the command ends without an error, and the
   roles check passes. If it refuses, read the message: it names the role or
   attribute that is wrong. **Waits for staging:** whether Cloud SQL lets its
   admin role give the backup role its row-security exemption is not yet
   known (ADR 0011).
4. **Check the schema version.** Run `node packages/db/scripts/db.ts up`.
   Success: "No pending migrations." If migrations run, the target time was
   before the current release; the services must run the release that matches
   the schema you end up with.
5. **Check row-level security.** Connect as the superuser and run:

   ```sql
   SELECT c.oid::regclass AS table_without_forced_policy
     FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND NOT c.relforcerowsecurity;
   SELECT rolname FROM pg_roles WHERE rolbypassrls AND rolname <> 'backup_reader';
   ```

   Success: both return no rows. If either returns a row, do not go on. Report
   the table or role. The full catalogue test (`pnpm test:db`)
   checks the same on a development database and is the reference for what
   "right" means.
6. **Complete [the steps after every restore](#steps-after-every-restore)**
   before you point anything at the new instance.
7. **Point the services at the new instance** (managed service: change the
   database host setting in Terraform and apply it; self-hosted: change
   `TPS_DB_HOST`, `TPS_DB_PORT` and `TPS_DB_NAME`), then start them in the
   order in [Start the services](#start-the-services).
8. **Keep the old instance until the restore is accepted.** Stop it taking
   writes (remove its network access) but do not delete it. Delete it only
   after the acceptance checks pass and a second operator agrees in writing,
   and within the retention rules for data it holds. The old instance holds
   `app.subject_key` in full, so never keep it longer than 35 days.

If the new instance cannot be used, the live instance is untouched. Start the
services against it again and choose another target time.

## Restore from the off-site snapshot

Use this to restore into a clean environment, for a real loss or for a
rehearsal. **Waits for PeaSoup:** the nightly snapshot has not run against
PeaSoup. **Waits for staging:** the restore host and the Google archive in the
backup project do not exist yet. Everything here also works against any
S3-compatible store, and against a local test store with
`bash infra/backup/test/restore.sh`, which does steps 2 to 7 against a throwaway
key and compares row counts and file hashes.

1. **Prepare a clean host** with `age`, `pg_restore`, `psql`, `sha256sum` and
   the S3 client, and an empty PostgreSQL 16 or newer server that is not
   reachable from the internet. For a rehearsal, remove the host's route to
   SMTP, webhooks and anywhere but the backup store.
2. **Pick the snapshot by its manifest.** List `manifests/` in the backup
   store and choose the newest key ending `.age` (or the one for the date you
   need). A snapshot with no manifest is incomplete: never use it.
   Success: you have a manifest key such as `manifests/<snapshot-id>.age`.
3. **Recover the private key** for the manifest's key id, following
   [Recover keys from escrow](#recover-keys-from-escrow). Success: the key file
   is on the restore host only.
4. **Decrypt the manifest** and read it:

   ```
   age --decrypt -i <private-key-file> -o manifest.json manifest.json.age
   ```

   It lists the format version, the key id of every object, the migration and
   roles script versions, the PostgreSQL version that wrote the dump, the
   tier, the dumps, the key snapshot and each file. If the manifest's key id
   is not one you hold, go back to step 3 for that version.
5. **Check every object's SHA-256 against the manifest.** For each dump, the
   key snapshot and each file, fetch the object, compare the SHA-256 of the
   encrypted object with `object.sha256`, then decrypt it and, for files,
   compare the SHA-256 of the result with `contentSha256`. Stop on any
   mismatch and report it: the copy is damaged or tampered with.
6. **Run the roles script on the clean server**, in the mode it needs (see
   step 3 of the point-in-time path), before any data. Then
   create the database owned by `migrator`:
   `node packages/db/scripts/db.ts prepare`.
7. **Restore the dump.** The dump leaves out `app.subject_key`. Restore it as
   `migrator`, with no owner or privilege statements, and stop on the first error:

   ```
   pg_restore --no-owner --no-privileges --exit-on-error --dbname=<target-url> <dump-file>
   ```

   Then load the newest key snapshot for keys whose party is in the restored
   data. **No command yet:** the restore command does this. The test script
   restores the whole key snapshot with
   `pg_restore --data-only --disable-triggers`, which needs a superuser. Do
   the same only on a rehearsal host where you are the superuser.
8. **Restore the files.** For each file in the manifest, put the decrypted
   bytes in the storage bucket at `clean/<tenant-id>/<file-id>`, using the
   manifest's `tenantId` and `fileId`. Use a clean bucket and the write key
   for that purpose. Never restore the `withheld/` prefix, which no snapshot
   holds. Success: the number of objects under `clean/` equals the number of
   files in the manifest.
9. **Complete [the steps after every restore](#steps-after-every-restore).**
10. **Start the services** in [the order below](#start-the-services).

If a step fails, stop. Nothing has touched the live service, so you can start
again from the failed step with a fresh database.

## Recover keys from escrow

The backup job holds only public keys. The private keys, the auth secret
and every platform key version are in escrow, outside Google and apart from
the backup store. Where the escrow is held is on the escrow record, which is
kept off this repository. The escrow record must list: each key id, who
holds each copy, how to request it, and the date of every recovery.

- **Who may ask.** Only a named operator on the escrow record. A second
  named person must approve the request. **Decided:** a two-person rule,
  because the keys decrypt every tenant's data.
- **Which key.** The manifest's `keyId`, and every `keyId` inside it, name the
  key versions you need. Older snapshots need older versions, which stay in
  escrow for at least 7 years after the last copy they protect expires.
- **Where you use it.** Only on the restore host. Never upload a private key to
  Google, PeaSoup, a ticket or a chat. Do not generate keys on a production
  host.
- **Afterwards.** Delete the key from the restore host when the restore is
  accepted (a rehearsal host is destroyed by the end of the next working day),
  and record the recovery: who asked, who approved, which key ids, when, and
  why. **No command yet:** the restore command that writes the record outside
  the database does not exist. The escrow record is where you write it.

## Steps after every restore

These apply to every path. A restore is not finished until they are done, and
until they are, no user may reach the service.

### Restore the auth secret

TOTP secrets and SSO secrets are encrypted with the auth secret, so a restore
without it brings back users who cannot sign in. Take the current auth secret
and **every older version** from escrow, put each in the secret store the API
reads, and name them as
[the rotation runbook](secret-rotation.md#add-the-new-version) describes
(`TPS_AUTH_SECRET_<n>` and `TPS_AUTH_SECRET_CURRENT`). Do the same for the
platform key (`TPS_SUBJECT_KEK_FILE` and `TPS_SUBJECT_KEK_VERSION`), or erased
people's audit values stay unreadable.

### Set restore mode

Restore mode is one row, `app.restore_mode`, and only `migrator` can write it.
Its job is to tell the application that the data came from a restore.

**No command yet:** the restore command sets it. The API and the worker do not
read it yet either, so you hold them at zero instances yourself (the step
"Before any restore"). By hand, on the restored database, as `migrator` and
as the first write before anything else connects:

```sql
UPDATE app.restore_mode SET active = true, request_id = gen_random_uuid();
SELECT request_id FROM app.restore_mode;
```

Write down the `request_id`. It ties every re-apply event to this restore.
Success: the second statement returns one id.

### Settle jobs and email

A restore brings back the job tables with their waiting, retrying and active
jobs, so a worker that started now could send release or reminder emails again.

1. **Keep the worker stopped.** **No command yet:** the restore command that
   cancels restored jobs, except those listed as touching only this database,
   does not exist. Until it does, do not start the worker on a restore of real
   data. On a rehearsal, the environment has no route to SMTP, so no email can
   leave.
2. **Do not resend release emails.** Pending decision emails (in the grants
   module) and the pending rows in other modules' outboxes stay pending.
   Nothing sends them by itself. Staff resend them by name from the console,
   after you give them the count per round, because some may have gone out
   after the snapshot. A decision stays private until released, and a
   released decision keeps its "sent" record (architecture rules 8 and 9).

### Re-apply the erasure ledger

This is the step that stops erased people coming back. Run it after every
restore and before any user traffic. Running it again is safe: it changes
nothing the second time.

1. **List the tenants.** Every tenant, whatever its status, because a suspended
   tenant is live again the moment it is reactivated. **No command yet:** the
   approved list function (`app.restore_tenant_ids()`) is not built. On a
   server where you are the superuser, `SELECT id FROM app.tenant` lists them.
   On a managed database, **waits for staging**: the admin role may not see
   them. Use the tenant list from your onboarding record.
2. **Put back ledger rows found only in a copy.** Compare the live export from
   [Before any restore](#before-any-restore) (and the newest off-site copy of
   the ledger, once the job writes one: **no command yet**) with
   the restored `app.erasure_ledger`. For each row that is in the export and
   not in the restored table, check it against evidence that storage access
   alone cannot produce: the erasure's audit event in the live export, or the
   tenant's written confirmation. For each row you confirm, run as `migrator`,
   with that tenant set:

   ```sql
   SELECT set_config('app.tenant_id', '<tenant-id>', false);
   SELECT app.restore_erasure_ledger_row(
     '<ledger-id>', '<party-id>', '<party_erased-or-subject_key_destroyed>',
     <subject-key-id-or-null>, '<audit-event-id-or-null>', '<erased-at>');
   ```

   It returns `true` when it inserted a row and writes
   `platform.erasure_ledger.row_restored`. An unconfirmed row erases no one:
   record it as a possible planted object, and list it again on every later
   restore.
3. **Re-apply for each tenant**, as `app_worker`, with the tenant set:

   ```sql
   SELECT set_config('app.tenant_id', '<tenant-id>', false);
   SELECT app.reapply_erasure_ledger();
   ```

   It reports counts as JSON: ledger entries seen, people erased again, keys
   destroyed, parties absent from the restore (kept, so they reach every later
   backup), memberships removed and answers cleared. It writes one
   `platform.erasure_ledger.reapplied` event. Success: the entries seen equal
   the tenant's ledger row count. If it stops with error `ER001`, the removal
   would leave the tenant with no administrator: the tenant must name another
   member as administrator in writing, you do that, and you run this step
   again for that tenant. Other tenants are not affected, but the restore is
   not finished until every tenant has reported.
4. **Sweep files.** **No command yet:** the file sweep that removes objects for
   erased or released files runs from the worker, which is stopped. Until the
   restore command runs it as a one-off process, a restore of real data is not
   complete.

### Clear restore mode

Only after every tenant has its `platform.erasure_ledger.reapplied` event for
this restore's request id, and the sweep has run. Check:

```sql
SELECT set_config('app.tenant_id', '<tenant-id>', false);
SELECT count(*) FROM app.audit_event
 WHERE action = 'platform.erasure_ledger.reapplied' AND request_id = '<request-id>';
```

Each tenant must return 1 or more. Then, as `migrator`:

```sql
UPDATE app.restore_mode SET active = false, request_id = NULL;
```

**No command yet:** the restore command makes this check and refuses to clear
restore mode without it. By hand, never clear it with a tenant missing.

## Start the services

Start in the order the stack uses, and wait for each to be healthy:

1. The migrate job (`node packages/db/scripts/db.ts prepare up`).
2. The API.
3. The worker, only once jobs are settled.
4. The console and the portal, then the reverse proxy.

Managed service: scale Cloud Run services up in that order. Self-hosted:
`docker compose up -d` brings them up in dependency order.

## Accept the restore

Do all of these before you declare the restore done, and write the result in
the restore record.

1. **Row counts.** For two tenants, compare the per-table counts of the restored
   database with the manifest's source (the test script prints the same
   comparison). They must match, apart from rows created after the snapshot.
2. **Isolation.** The row-level security query in step 5 of the point-in-time path
   returns no rows, and a sign-in as a user of tenant A shows no data from tenant B.
3. **Sign-in.** Sign in with a password and TOTP, and with an SSO provider if
   the tenant has one. If TOTP fails, the auth secret is wrong or an old
   version is missing: stop and go back to
   [Restore the auth secret](#restore-the-auth-secret).
4. **Files.** Compare the file hashes against the manifest (step 5 of the
   off-site path) and download one file through the portal. Its bytes must
   match its hash.
5. **Audit.** Each tenant has `platform.erasure_ledger.reapplied` and, for any
   confirmed row, `platform.erasure_ledger.row_restored` events. No audit row
   was edited or deleted.
6. **Timings.** Write down the time of each step and the total, in UTC, for
   the rehearsal log. The quarterly rehearsal alternates this path and the
   point-in-time path; once a year it restores a yearly snapshot, which also
   proves the dump still restores into a current PostgreSQL and the escrowed
   keys still work.

## If a restore fails

Nothing in this runbook changes the live service until you point services at
the new database. If you have not, start again with a fresh database. If you
have, point them back at the old instance (kept under
[the point-in-time path](#restore-to-a-point-in-time) step 8). Report the failed
step and its output, with no data in it, to the lead.
