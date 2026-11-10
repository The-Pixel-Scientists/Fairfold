# ADR 0011: Backups and recovery

- **Status:** proposed
- **Date:** 2026-11-08
- **Deciders:** Aaron Gardner

## Context

The managed service will hold funders' applications, decisions and personal
data. It runs on Google Cloud in London
([ADR 0012](0012-hosting-targets-and-cells.md)). A funder needs its data back
after a bad change, the loss of the London region, or the loss of the Google
account itself, and nobody who breaks into production should be able to
destroy the copies.

Constraints:

- [Architecture rule 1](../ARCHITECTURE.md): the backup job runs against any
  PostgreSQL 16 or later and any S3-compatible store with object lock. Cloud
  specifics live only in `infra/terraform/`.
- [Architecture rule 2](../ARCHITECTURE.md): every tenant table forces
  row-level security. `pg_dump` turns row security off and stops with an error
  on any table a policy would filter, so it has to run as a role that is
  exempt, and [ADR 0003](0003-query-builder-and-migrations.md) gives no role
  that exemption.
- [ADR 0027](0027-erasure-across-modules-and-audit.md) sets the tiers, the
  erasure ledger and the key snapshot, and says this ADR records them. The
  two must agree.
- [ADR 0030](0030-files-and-reverse-proxy.md): clean files never change after
  scanning, and the live files bucket has no versioning.
- Object lock protects against us and against attackers. It does not protect
  against the provider failing, as UKCloud's customers found when it went into
  compulsory liquidation in October 2022. Copies kept for years need two
  independent providers.

## Options considered

The UK-sovereign off-site provider (researched 27 September 2026). Ownership
was checked at Companies House. "Claimed" means the provider's own site says
so; certificates were not checked against the IASME or UKAS registers. Costs
are per month for 54 snapshots of 100 GB.

| Provider    | Ownership                       | Object lock                                           | Restore compute                                   | Certificates and G-Cloud                                             | Cost and egress                                 |
| ----------- | ------------------------------- | ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| PeaSoup     | UK, no parent company           | Compliance mode claimed; maximum retention not stated | VMs                                               | ISO 27001 and Cyber Essentials Plus claimed; not found in G-Cloud 15 | £27; no egress fees or minimum term             |
| Centerprise | UK                              | Yes; compliance mode not stated                       | Disaster recovery service; general VMs not stated | ISO 27001, 27017, 27018, Cyber Essentials Plus, G-Cloud 15           | £54; 5 TB and 12-month minimums; egress charged |
| Civo        | UK, with a UK minority investor | Not documented                                        | VMs, Kubernetes, managed PostgreSQL               | Claimed; G-Cloud 14, not found in G-Cloud 15                         | About $60; egress free                          |

Krystal offers no object lock. iomart and Hyve have no public S3 product. HA
Hosting does not mention object lock. Pulsant and 4D were excluded because
their ownership or data centres have passed to foreign investors. No candidate
publishes a cold tier.

What each snapshot copies:

1. **Everything, every night.** Simple, but Google's egress alone would cost
   5 to 10 times the storage bill.
2. **A full database dump, new files only, and a daily manifest** of every
   object the snapshot needs. Each snapshot still restores in full, because
   uploaded files never change after scanning.

The second copy of the long-term archive:

3. **PeaSoup alone.** One provider failure loses up to 7 years of copies.
4. **A second UK provider.** Adds a second contract and minimum terms.
5. **Google, in a separate project with locked retention.** Independent of
   PeaSoup, and production cannot delete it.

How `pg_dump` reads tables with forced row-level security:

6. **A dedicated role with `BYPASSRLS`.** The standard route. It needs a named
   exception to rule 2.
7. **`pg_dump --enable-row-security`.** Never acceptable. It dumps only the
   rows the role can see, and it succeeds, so a backup that is missing data
   looks complete.
8. **Exempting `migrator` or a table owner.** Gives the role that changes the
   schema the right to read every tenant's rows.
9. **A policy granting the backup role every row.** Still needs option 7's
   flag, and a table whose policy is missing comes back short with no error.
10. **Logical replication to a server we run, dumped there.** The replication
    role's initial table copy is subject to row security unless that role is
    exempt too, so it does not avoid the question.

## Decision

Options 2 and 5, with PeaSoup as the off-site provider, as Aaron decided on
27 September 2026.

Option 6 is proposed here for Aaron's decision. The decisions of 27 September
cover the providers, the tiers and the snapshot method. The exempt role came
later, from a security review of the database roles, and it is an exception to
a security rule that only he can accept.

### Three layers

1. **High availability** across two London zones, on Cloud SQL.
2. **In-London backups:** Cloud SQL automated daily backups stored in
   `europe-west2`, 35 retained, with 7 days of point-in-time recovery. No
   on-demand backup is kept longer than 35 days, because
   [ADR 0027](0027-erasure-across-modules-and-audit.md#backups-and-restores)
   limits any copy holding `app.subject_key` in full to that.
3. **A nightly, encrypted, complete snapshot off-site** in immutable storage.

Aaron's decision of 27 September named file-storage versioning as part of
layer 2. ADR 0030 came later: a delete has to remove the only copy, so the
live files bucket has no versioning and the sweep refuses to run if it is on.
This ADR follows ADR 0030. Layer 3 is the only second copy of a file, and a
file deleted before its first snapshot cannot be recovered. This change needs
Aaron's confirmation.

Isolated tenants, with a dedicated database or instance, get the same design.

### The off-site provider

- **UK-sovereign** means UK-owned and operated, under UK jurisdiction only,
  with no parent company subject to foreign disclosure laws such as the US
  CLOUD Act, and with data stored and administered in the UK. ADR 0012 defines
  "sovereign" for every jurisdiction.
- **PeaSoup** receives every daily snapshot, holds all three tiers and hosts
  the restore rehearsals on its VMs.
- Civo is the candidate to revisit for hosting phase 3.

### Tiers and locks

| Tier    | Which snapshot                       | Kept for  |
| ------- | ------------------------------------ | --------- |
| Daily   | Every snapshot                       | 35 days   |
| Monthly | The snapshot of the 1st of the month | 12 months |
| Yearly  | The snapshot of 1 January            | 7 years   |

- That is at most 54 full snapshots: 5.4 TB at 100 GB each, 54 TB at 1 TB.
- Every object is written with its own compliance-mode retain-until date,
  dated from the snapshot's start in UTC. A lock can be lengthened and never
  shortened, so a wrong 7-year date costs 7 years of storage.
- In each store, a file's lock is extended to the longest tier of any snapshot
  in that store that references it. Pruning removes only objects whose lock has
  expired and that no manifest still within its own retention references.

### A complete snapshot

Each night's snapshot holds:

- a full dump of each application database, in `pg_dump`'s custom format, from
  a `pg_dump` at least as new as the server, so that it restores into
  PostgreSQL 16 and newer. `app.subject_key` rows are left out;
- a key snapshot of `app.subject_key` (see "Erasure and restores");
- every clean file object added since the last successful snapshot at PeaSoup,
  and never the quarantine prefix. The Google archive measures its own copy
  (see "The Google archive");
- the whole erasure ledger;
- a manifest listing every object the snapshot needs: a format version, ids,
  SHA-256 hashes, sizes, the key id, the migration and roles script versions,
  the PostgreSQL and `pg_dump` versions, the tier and the retain-until date.
  It holds no file names or personal data.

Every upload is read back and checked against its hash, except on the Google
archive, which checks a reported checksum instead (see "The Google archive").
The manifest is written last, so a snapshot without one is incomplete and is
never used.

The metadata databases of [ADR 0039](0039-bi-tool-for-insight.md) are backed
up at the same tiers. Its warehouse databases are not, since they are reloaded
and an old copy would bring back erased people.

Nothing in `infra/backup/` names Google. The job stops, writing nothing, unless
the bucket reports object lock and versioning on the backup store and a probe
object's retention reads back.

The job's nightly read of every tenant writes no `audit_event`, because the
backup role has no `INSERT` by design. This is proposed as a named exception to
[architecture rule 4](../ARCHITECTURE.md), for this one read and with these
guards:

- **Where the record is.** Each run, successful or not, ends by writing a run
  record to the backup store: a run id, outcome code, tier and counts, with
  errors as codes. No row data, file names, keys or credentials. If no run
  record arrives for 26 hours, the operator is alerted.
- **How long it is kept.** 12 months, the audit log's minimum
  ([ADR 0003](0003-query-builder-and-migrations.md)), under a compliance-mode
  lock.
- **Who can read it.** Only the operators named in the restore runbook. No
  tenant, app role or production identity can.
- **Tamper resistance.** The job's credential can create a run record but not
  delete one, and the compliance-mode lock keeps every version for its full
  term, so a later write cannot hide it. For the Google archive, the backup
  project's audit logs also record each access, out of production's reach.

Copying the dump every 6 hours instead of nightly would multiply the dump's
Google egress by four: from about 3 TB to 12 TB a month at 100 GB per dump,
which is roughly $900 to $1,300 a month instead of $225 to $320 on Google's
published London rates of September 2026, and $8,000 to $10,000 at 1 TB per
dump. Higher volumes earn lower rates, so these are upper bounds. Keeping the
extra dumps for 35 days adds about £50 a month at PeaSoup at 100 GB per dump.
V1 copies nightly.

### The Google archive

Google also keeps the 12 monthly and 7 yearly snapshots, so the long-term
archive exists at two independent providers. This is separate from layer 2.

- The same dump and manifest, and every file the manifest references that was
  not in the last successful Google copy, are written to a Cloud Storage bucket
  in `europe-west2`, in a **separate backup project**, in the Archive storage
  class, with per-object retention in locked mode for 12 months or 7 years by
  tier. PeaSoup's nightly file delta plays no part in this.
- A Google snapshot is complete only when every object its manifest lists is
  present in that bucket, with retention at least as long as the snapshot's
  tier needs. The job checks this from a listing of the bucket before it writes
  the manifest there, last, and the same listing shows which files are missing
  from the last Google copy. A file first copied under a 12-month lock is
  lengthened when a yearly snapshot references it, so the check covers files
  already held.
- Production's identity can create objects there, lengthen the retention of
  existing objects, list objects, and read their metadata (name, size, checksum
  and retention date) and the bucket's settings, and nothing else. It cannot
  read an object's content, shorten retention, delete or overwrite an object,
  override retention, or administer the bucket or its permissions. Object names
  there are ids and hashes, so a listing shows no personal data.
- An upload to the Google archive is checked by comparing the checksum and size
  the listing reports with those the job computed before uploading, because
  that identity cannot read the content back.
- No retention date may run past the start of the snapshot that set it plus
  that tier's period and one day. The job refuses a later date. Since a stolen
  production credential could lengthen a lock without limit, and that cannot be
  undone, an identity in the backup project also checks every object's date
  daily and alerts the operator to any later one.
- File objects that a monthly or yearly snapshot references get the same
  retention in the backup bucket, whatever the live bucket's own rules say.
- The key snapshot is not copied here. It stays on the 35-day tier.

### Encryption and escrow

- Every object is encrypted before it leaves the cell, to public recipient
  keys. The job holds no private key and cannot read what it wrote. Every
  object records its key version, and rotation adds a new recipient key
  without re-encrypting old snapshots.
- Google copies use the same keys, so they stay usable if the Google account
  is lost and a compromise inside Google cannot read them.
- Key pairs are generated offline, never in Google or on a production host.
- Held in escrow outside Google, and apart from PeaSoup, in at least two
  places: the backup private keys, the auth secret
  ([ADR 0010](0010-authentication-security-rules.md)), every platform key
  version ([ADR 0027](0027-erasure-across-modules-and-audit.md)) and every
  suppression secret version
  ([ADR 0033](0033-consent-and-communications.md)).
- Old key versions stay in escrow while any copy they protect exists, for at
  least 7 years. None of these keys is ever stored in a snapshot.
- The recovery procedure is in the restore runbook. Where the escrow is held,
  and who may recover from it, is for Aaron to decide before live data. Every
  recovery leaves a restore record (see "Restore records").

### The backup role

`backup_reader` is the one role with `BYPASSRLS`. If Aaron accepts option 6, it
is a named exception to [architecture rule 2](../ARCHITECTURE.md), with these
guards:

- It holds `CONNECT`, `USAGE` on schemas and `SELECT` on tables and sequences,
  and nothing else: no write, no `EXECUTE` on an approved definer function, no
  membership in any role, and no role is a member of it. The roles script sets
  this and checks it, and the catalogue and privilege tests fail on any change.
- Only the nightly backup job connects as it. The API, worker, migrate job and
  seed never do, and a unit test fails if their connection code names it.
- Its password is a secret that only the backup job's own identity can read,
  mounted as a file. It never appears in arguments, environment values, logs
  or the image. Connections use TLS with `verify-full`.
- In deployed environments the roles script receives only the role's SCRAM
  verifier, which cannot be used to log in, so the migrate job never holds the
  password. This is not built yet: today the script reads every login role's
  password, and the Compose migrate job mounts them all. The change must land
  before the job first runs against a deployed environment.
- The roles script still connects as the database admin, and whoever holds that
  credential can reset any role's password. The verifier closes the plain
  route, not this one, so the admin credential goes only to the step that runs
  the roles script. Aaron decides whether that remaining gap is acceptable.
- The job refuses to start as any other role, or if the role lacks the
  exemption. It never uses `--enable-row-security`.

### Whether Cloud SQL can give the exemption

**This is not yet answered.** PostgreSQL 16 lets a role grant `BYPASSRLS` only
if it holds that attribute itself, and Cloud SQL provides an admin role rather
than a superuser. Whether that admin role holds it has not been confirmed
against Google's documentation or a real instance. The roles script's managed
mode does not assume the answer: it refuses to run unless the admin role holds
the attribute, names the gap, and has a test proving that it fails closed.
The first run against a staging instance gives the answer.

If the roles script passes, backups run as this ADR describes.

If it refuses, **Aaron needs to decide**, and this is the proposed order:

1. **The provider's own export.** The nightly dump comes from Cloud SQL's
   export service, into a private bucket in the cell, and is encrypted and
   removed from that bucket as soon as it completes. Only the dump step
   changes. It is accepted only after a restore into a clean PostgreSQL shows
   that row counts on forced tables match across two tenants, and only if it
   can keep `app.subject_key` out of the data snapshot and provide the key
   snapshot from the same database snapshot, as ADR 0027 requires. The check
   repeats at every rehearsal.
2. **PostgreSQL run by us in the cell,** with a true superuser. The backup role
   and the job stay as they are, but Cloud SQL's layers 1 and 2 go, so this
   needs a new ADR to replace them.

Until one of these is proven, staging runs on synthetic data without off-site
snapshots, and no live data enters the service.

In every outcome these stay ruled out: `pg_dump --enable-row-security`,
exempting `migrator` or a table owner, removing forced row-level security from
any database or copy, and any policy that grants the backup role every row.

### The restore role

`restore_operator` is the restore runbook's role, wherever this ADR and
[ADR 0027](0027-erasure-across-modules-and-audit.md) name that role. The roles
script creates it as `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`, `NOCREATEDB`
and `NOREPLICATION`. It belongs to no role and no role is a member of it, so
`backup_reader` stays the only role with `BYPASSRLS`.

- Only the restore command connects as it, with a password mounted as a file
  on the restore host.
- It holds `CONNECT`, `USAGE` on schema `app`, and `EXECUTE` on the definer
  functions below. It has no right on any tenant table.
- It holds `SELECT` and `UPDATE` on `app.restore_mode`, and its `UPDATE` policy
  has `WITH CHECK (active)`. So it can set restore mode but not clear it, and
  only `app.finish_restore(...)` clears it, after its checks.
- Its functions are `app.restore_tenant_ids()`,
  `app.restore_erasure_ledger_row(...)`, `app.advance_event_sequences()`,
  `app.assign_restore_admin(...)`, `app.reapply_erasure_ledger_without_admin(...)`
  and `app.finish_restore(...)`. Each refuses outside restore mode.
- Migration 0048 leaves this work with `migrator` for now, which also has no
  `BYPASSRLS`. It moves to `restore_operator` with the restore tooling, and
  `app.restore_erasure_ledger_row(...)` then becomes the definer function ADR
  0027 describes.

### Erasure and restores

This section records what
[ADR 0027](0027-erasure-across-modules-and-audit.md#backups-and-restores)
decides. If the two ever differ, ADR 0027's wording changes with this one.

- **Effect in backups.** An erasure cannot reach inside a locked copy. It takes
  full effect in backups, as does a funder's exit, only when the last copy
  holding the data expires: up to 7 years for the yearly tier. ADR 0027 holds
  the wording for privacy notices and processing agreements.
- **Key snapshot.** `app.subject_key` rows are written, still wrapped, as a
  separate snapshot taken from the same database snapshot as the dump. It is
  stored apart from the data and kept on the 35-day tier only. So a destroyed
  key stays destroyed, and an erased person's audit values are unreadable in
  every copy within 35 days.
- **Ledger, when written.** An ids-only job writes each new ledger row off-site
  as one object named by its id, under a 7-year object lock. Its put-only
  credential is separate from the backup writer's, and can create objects in
  the ledger's bucket but not read, list, replace or delete them. It retries
  until it succeeds, and a row not copied within an hour alerts the operator.
- **Ledger, with each snapshot.** The whole ledger is also copied with each
  manifest.

Restore mode is a row in the database, so it cannot protect the database while
that is being replaced, and after losing the region there is no database to
write it to. Until step 4 the gate is that nothing is running.

Steps that work through tenants cover every tenant whatever its status, because
a suspended tenant's restored data is live again the moment it is reactivated.
They take their list from `app.restore_tenant_ids()`, an approved definer
function executable only by `restore_operator` and `app_worker`, which
returns ids alone and refuses outside restore mode. They never use
`app.tenant_ids()`, which lists active tenants only.

Every restore, of any layer and to any point, follows these steps:

1. Before restoring to any point earlier than the latest, export the current
   ledger from the live database if it can still be read. Point-in-time
   recovery alone is enough only for a restore to the latest point.
2. Stop the API, the worker, the backup job and every scheduler, and hold them
   at zero instances. The restore command writes the start of the restore
   record, and goes no further until the operator confirms that nothing is
   running.
3. Restore the database, with everything still stopped. The restored
   restore-mode row reads as normal, because the snapshot was taken outside a
   restore.
4. As the first write to the restored database, before anything else connects,
   the restore command sets restore mode, in a row no app role can write.
5. A restore from a snapshot, which holds no subject keys, loads the newest key
   snapshot, for keys whose party is in the restored data.
6. The restore command settles what the dump brought back and would otherwise
   act by itself. All of this happens before re-apply, so that it never touches
   the work re-apply starts:
   - **Jobs.** Every job restored as waiting, retrying or active is cancelled,
     except in queues the restore command lists as changing only this database,
     which wait until step 12. A queue is off the list until it has been
     reviewed, so no restored job can send an email or call out. Recurring
     schedules return when the worker next starts. An event handed to a
     cancelled job is sent again by
     [ADR 0034](0034-event-outbox.md#cursors-and-replay)'s replay, an audited
     operator action taken once the restore has finished.
   - **Emails.** Pending `grants.decision_email` rows, and pending rows in every
     other module's outbox, stay pending and nothing sends them by itself. Only
     a named, audited resend by staff
     ([ADR 0020](0020-release-emails-without-a-worker.md)) can. Any of them may
     have gone out after the snapshot was taken, so the restore report gives
     staff the count for each round before they choose.
   - **Event outbox.** Restored rows keep their numbers and cursors stay where
     the restore put them. The relay resumes after step 12, so delivery is at
     least once, as [ADR 0034](0034-event-outbox.md) already allows. Receivers
     drop duplicates by event id, and by then each id of an erased person points
     at the anonymised party.
7. `app.advance_event_sequences()`, an approved definer function that only the
   restore runbook's role can execute and that refuses outside restore mode,
   moves the counter of every tenant on that list forward by a fixed margin, in
   that tenant's context, and writes `platform.event_sequence.advanced` with the
   old and new values. The margin is 10 billion, more than the 1.84 billion or so numbers
   the relay could hand over in 7 years at 500 a minute, and one more margin is
   added for each earlier restore recorded after the point restored to. No
   number already sent is reused, and receivers see a gap
   ([ADR 0034](0034-event-outbox.md#order)). This runs before re-apply, which
   publishes events.
8. The restore command lists every ledger row found only in an off-site copy or
   the export, and not in the restored table, with its ledger id, party id,
   kind, `erased_at`, audit event id and the copies that hold it.
9. The operator checks each row against evidence that storage access alone
   cannot produce, such as the erasure's audit event in the live export or the
   tenant's confirmation, and confirms it by id. Each confirmed row is inserted
   through `app.restore_erasure_ledger_row(...)`. An unconfirmed row erases
   nothing, is reported as a possible planted object, and stays listed on every
   later restore until its copies expire.
10. `app.reapply_erasure_ledger()` re-applies the ledger of every tenant on that
    list from the restored table. Where
    [ADR 0027](0027-erasure-across-modules-and-audit.md#backups-and-restores)
    stops it for a tenant that would be left with no admin, that tenant holds
    the whole restore until the operator takes one of two routes. Each is an
    approved definer function that only `restore_operator` can execute and that
    refuses outside restore mode, run with that tenant set. `app_worker` can
    execute neither, and `app.reapply_erasure_ledger()` takes no argument that
    lifts its stop.
    - **Promote a member.** On the tenant's written instruction,
      `app.assign_restore_admin(...)` makes another of its active members an
      admin, and refuses a member the tenant's ledger names. In the same
      transaction, in that tenant, it writes `platform.restore.admin_assigned`
      with actor kind `operator`, the restore's request id, the membership id,
      the role, the id of the operator's own credential, and the reference of
      the written instruction, an opaque id with no personal data. The operator
      then runs this step again for that tenant.
    - **Leave the tenant with no admin.** If the tenant has no other member to
      promote, or none answers within four hours of the operator's written
      request to its contact on record,
      `app.reapply_erasure_ledger_without_admin(...)` completes re-apply through
      the same engine, so the person is still erased and the membership removed
      with the standard event, and the tenant gets its
      `platform.erasure_ledger.reapplied` event. It refuses if the tenant has
      another active admin. It sets the tenant to `suspended`, and revokes every
      session whose active tenant it is, because a session checks its membership
      and not its tenant's status. In the same transaction it writes
      `platform.restore.tenant_left_without_admin` with actor kind `operator`,
      the restore's request id, the removed membership id, the id of the
      operator's own credential and a reason code, `no_member` or `no_answer`.
      Nobody can use the tenant until an operator reinstates it, a later action
      that the restore tooling adds. It runs only on the tenant's written
      instruction and only for a tenant holding that event, establishes a new
      admin and writes `platform.restore.admin_assigned`.
11. The file sweep runs for every tenant on that list
    ([ADR 0030](0030-files-and-reverse-proxy.md)), so objects brought back for
    erased or released files are gone.
12. The restore command calls `app.finish_restore(...)`, an approved definer
    function that only `restore_operator` can execute and that refuses outside
    restore mode. It is the only thing that clears restore mode, and it refuses
    until re-apply and the sweep have completed for every tenant on that list.
    In one transaction it refuses if a tenant is already set, then takes each
    tenant from `app.restore_tenant_ids()` in turn, setting `app.tenant_id` with
    `set_config(..., true)` inside its own body. Its reads and writes stay under
    the ordinary tenant policies, so no policy crosses tenants and ADR 0003's
    helper does not change. For each tenant it checks for the
    `platform.erasure_ledger.reapplied` event and the sweep audit event of this
    restore, tied to it by the restore's request id. A tenant where re-apply
    stopped has no such event. If any is missing it names those tenants, nothing
    commits, and steps 10 and 11 can safely run again for them. No option skips
    a tenant or clears restore mode without this check. Otherwise, in that
    transaction, it writes the restore's audit events (see "Restore records"),
    empties the setting and clears restore mode. The restore command then writes
    the end of the restore record and lets the services start. The API takes
    traffic, and the worker takes up its queues and relay again.

While restore mode is set, the API takes no traffic and a worker that starts
does no queue, sender, relay, outbox, retention or purge work. Each reads the
row when it starts and holds back if it is set. Steps 10 and 11 alone run, as a
one-off worker process that the restore command starts as `app_worker`, working
through the tenants on that list directly and not through the queue.

### Restore records

Each restore's start and end, each change of restore mode, and each recovery of
a key from escrow leaves a record that names the operator, from that person's
own credential and never a shared one. A recovery made outside a restore makes
its record through the same command.

- **At once, outside the database.** Each is written as one object under a
  7-year object lock, with what was restored, the target time and a reason
  code. A put-only credential of its own can create these objects but not read,
  list, replace or delete them, as with the ledger's copies. No rollback can
  reach them, including at the start of a restore, when the database may not
  exist.
- **In the restored database.** In step 12 `app.finish_restore(...)` writes each
  record, and any earlier restore's record the restored data lacks, as
  `platform.restore.*` audit events in every tenant from
  `app.restore_tenant_ids()`, whatever its status, with actor kind `operator`
  and a request id that ties the event to the object. They are written after the
  restore, so the restore cannot remove them.

### Recovery targets

| Event                                          | Data lost      | Back within                         |
| ---------------------------------------------- | -------------- | ----------------------------------- |
| A fault within the London region               | Minutes        | 4 hours (the V1 target)             |
| Losing the London region or the Google account | Up to 24 hours | About a day, on the second provider |

These are targets until a rehearsal has measured them.

### Rehearsals

- Every quarter a timed restore, alternating between an in-London
  point-in-time restore and a full restore from the off-site copy to a clean
  environment on PeaSoup's VMs.
- Once a year a yearly snapshot is restored, which also proves the dump format
  still restores into a current PostgreSQL and the escrowed keys still work.
- A rehearsal restores real personal data, so its environment counts as part of
  production for access and data protection:
  - it has no route to SMTP, to outbound webhooks or to anywhere else beyond the
    backup store, and the restore command checks this and stops if a route
    exists;
  - only the named restore operators can reach it. Nobody else, including
    support staff and developers, gets access, and no data leaves it;
  - it is destroyed, with its disks and any key copies, by the end of the next
    working day, and the restore record notes when.

### Conditions before live data

- **PeaSoup's contract.** Its terms allow deletion on non-payment or
  termination, which clashes with 7-year locks. They must be amended so that
  locked data is kept until it expires and is returned on non-payment,
  termination or insolvency.
- **The 7-year tier's legal basis** (charity record-keeping) must be stated in
  the DPIA, privacy notices and data processing agreements, and confirmed by a
  solicitor.
- **Privacy notices and processing agreements** name the backup providers,
  their locations (the UK, and London for Google) and these retention periods.

### What waits for staging

No Google project or PeaSoup account exists yet, so these are decisions and
not working systems:

- whether the roles script can give the backup role its exemption on Cloud SQL;
- the roles script taking only the backup role's SCRAM verifier in deployed
  environments;
- whether Google's permissions can allow listing objects, reading their metadata
  and lengthening retention on existing objects, without allowing their content
  to be read or anything else. If they cannot, the completeness check and the
  manifest write move to an identity in the backup project, and production's
  identity keeps only create and lengthen. Reading content is not granted;
- the restore tooling: the `restore_operator` role, the restore-mode row, the
  hold on the API and worker, the restore-only tenant list, the one-off re-apply
  process, `app.finish_restore(...)`, the two routes for a tenant left with no
  admin and the later reinstatement of a suspended one, cancelling restored
  jobs, the counter function, the restore records and the run record;
- PeaSoup's confirmation that compliance-mode dates can be set per object
  through its S3 API, for 7 years, and extended later. Until it confirms, no
  7-year lock is set there;
- Cloud SQL's backups and point-in-time recovery, the backup project, and the
  first real run of the job;
- the timed rehearsals, and so the recovery targets.

## Consequences

- Backups and recovery no longer depend on one provider or on Google, at the
  cost of a second system to run, keys to look after for years, and a yearly
  restore to prove they still work.
- This ADR amends ADR 0003, whose role table says every role is `NOBYPASSRLS`,
  by adding `backup_reader`. It qualifies ADR 0024's statement that no role has
  or will be given `BYPASSRLS` and ADR 0029's catalogue check for the same
  thing, both of which concern roles that run migrations and application code.
  Aaron decides whether this is enough or ADR 0003 needs its own amending ADR.
  Status lines change in a later housekeeping change.
- This ADR adds a new entry to ADR 0003's list of tenant sources: the entries
  of `app.restore_tenant_ids()`, in the restore command and the one-off worker
  process only. ADR 0003's limit of the fan-out to the scheduler's platform job
  widens to those two places and no others. The Semgrep rule that enforces this
  admits only those files, and its test holds a use in another file that must
  fail. ADR 0003's helper is unchanged and still sets one tenant per
  transaction. `app.finish_restore(...)` alone moves between tenants within a
  transaction, inside its own body.
- `restore_operator` and this ADR's definer functions join ADR 0003's role table,
  its list of approved definer functions and the catalogue test.
- `docs/ARCHITECTURE.md` lists two named exceptions to its rules. On acceptance
  it gains two more: the backup role under rule 2, and the backup job's read
  under rule 4.
- Rule 4: the nightly read leaves a run record outside the database and no
  `audit_event`. Restores, restore-mode changes and escrow recoveries leave a
  record that no rollback can remove, and audit events after the restore.
  Promoting a member, leaving a tenant with no admin and reinstating that tenant
  each write their own audit event in that tenant, in the same transaction.
- A restore cancels restored jobs and leaves pending emails for staff to resend
  by name, so work in flight at the snapshot can need replaying or sending
  again. A pending email that had already gone out goes twice if staff resend it.
- A rehearsal holds real personal data for up to a working day after it ends,
  in an environment that has no outbound route and only the named operators can
  reach.
- A file deleted in error can be recovered only from a snapshot taken before
  the delete, and a file still in quarantine is not in any snapshot.
- A wrong retain-until date cannot be undone.
- A restore needs an operator's attention, for every ledger row found only in
  a copy.
- One tenant stopped by the no-admin rule holds the restore for every tenant
  until the operator promotes a member or, with no member to promote or no
  answer within four hours, leaves it suspended with no admin. A restore can run
  past its target by those four hours. A tenant left this way stays unusable,
  with no admin, until it instructs an operator in writing, and the person is
  erased either way.
- No table is added, so this ADR adds no row-level security policy or
  classification entry.

## Dependency check

No dependency is added here. The backup job's tools get their ADR 0002 records
in the commit that first uses each one.
