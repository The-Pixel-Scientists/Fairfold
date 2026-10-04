# ADR 0027: Erasure across modules and in audit

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0003](0003-query-builder-and-migrations.md#audit-retention-the-exception-to-rule-4)
left one question open:

> Erasure is not yet designed. An append-only log cannot hold a personal value
> that an erasure request (E3) must remove. The leading option is to encrypt
> personal values in each event's before and after data with a key per data
> subject, and erase by deleting that key ("crypto-shredding"). The
> alternative is to hold such values by reference in a table that erasure can
> change. An ADR decides this before E3 work starts, and also covers the typed
> identifiers and IP addresses that `auth.audit_event` keeps for 12 months.
> Until then, tenant audit events hold ids, codes and field ids only, never
> personal values.

Since then the platform has become a suite of modules sharing one warehouse
([ADR 0016](0016-modular-suite-and-shared-warehouse.md)), with the party
module as the master record for organisations and people
([ADR 0017](0017-bespoke-crm-party-core.md)). A person's data now lives in
several schemas, some of them in modules a tenant has switched off; in
snapshots of what was submitted; in form answers that mix personal and
internal fields; in audit; in backups kept for up to 7 years; and in
warehouse snapshots a tenant has downloaded. The
[V1 plan](../V1-PLAN.md#e3-audit-and-data-governance) asks for an erasure
that "removes or anonymises a person's personal data while preserving the
audit trail's integrity", and Gate 1 needs a subject party id on audit events
and a path from every classified table to its data subject.

Constraints:

- [Architecture rule 4](../ARCHITECTURE.md): the audit log is append-only,
  and only `app.purge_expired_audit()` deletes from it (ADR 0003).
- A party is never deleted while another module refers to it; erasure
  anonymises it in place (ADR 0017).
- Modules own their schemas and reach each other only through contracts. A
  switched-off module keeps its data. Foreign keys cross modules only to
  published keys (ADR 0016).
- Backups, as decided on 27 September 2026 for staging: every daily
  snapshot is kept off-site for 35 days, the 1st-of-month snapshot for 12
  months and the 1 January snapshot for 7 years, each under its own object
  lock, so nothing can change a copy once written.
- Portable: `node:crypto` and PostgreSQL only, no cloud key service in
  application code (rule 1).
- MVP1 data is synthetic, so no existing row needs migrating.

## Options considered

Personal values in tenant audit events:

1. **Crypto-shredding.** Encrypt each personal value under a key for its
   data subject, and erase by destroying the key.
   - Pros: audit rows never change. Erasure is one key. Copies of the log in
     backups become unreadable as soon as the last copy of the key is gone,
     which can be far sooner than the last copy of the data.
   - Cons: a platform key with escrow and rotation; a decryption on every
     read of a personal value; personal audit values cannot be searched or
     indexed; losing the platform key makes every personal audit value
     unreadable; and it only works if keys stay out of the long backup tiers.
2. **Values by reference.** The event holds a reference to a row in a values
   table that erasure clears.
   - Pros: no cryptography and no key escrow; plain reads.
   - Cons: the evidence for every personal change sits in a table that can be
     updated, so the log is append-only in name only for those values.
     Erasure has to find and clear every reference. The values stay readable
     in every backup of that table until its tier expires, up to 7 years.
3. **No personal values in audit, ever.** Field ids only, as now.
   - Pros: nothing to erase.
   - Cons: the log cannot show what a person's email address changed from
     and to, which disputes, fraud checks and subject access need, and each
     module would ask for an exception.

Typed identifiers and IP addresses in `auth.audit_event`:

4. **Hash them.** A plain hash of an IPv4 address is reversed by brute
   force in minutes, a keyed hash hides it from the investigations that need
   it, and blocking or reporting an attacker needs the real address.
5. **Encrypt them under the subject key.** Most auth events have no subject
   to key: an account spans tenants, and a failed sign-in for an unknown
   address belongs to no party.
6. **Keep them in clear for the fixed 12 months,** under a stated legal
   basis.

Subjects per audit event:

7. **One nullable subject party id.**
8. **A second column, or a link table,** for events about two people.

Erasure across modules:

9. **One erasure contribution per module,** called by a platform engine in
   one transaction.
10. **Each module subscribes to an "erased" event** and erases on its own.
    Looser coupling, but a failure leaves a person half erased, and ADR 0016's
    handlers skip tenants that have the module switched off.

## Decision

Options 1, 6, 7 and 9.

### Erasure is a named human action

- A tenant member with the erasure permission asks to erase one party in the
  console, after step-up re-authentication within 5 minutes
  ([ADR 0010](0010-authentication-security-rules.md)), with a reason code
  from a checked list and a literal confirmation. The server re-validates the
  request with the shared domain schema, and the acting member comes from the
  session (rule 6). An unknown id, another tenant's party and an erased party
  all get the same not-found problem, which never echoes the id.
- The request records who asked (S11-67's job request), writes
  `platform.erasure.requested` and sends one job holding ids only
  ([ADR 0009](0009-background-jobs.md)). The worker runs the erasure in one
  tenant transaction. Every database function it calls refuses unless the
  job request in the current tenant names this party, or, only while the
  cell is in restore mode, a ledger row does (see "Backups and restores").
- A request names a person. Clearing an organisation's personal columns (its
  registered address, often someone's home) uses the same engine with the
  organisation named.
- Staff leave before they are erased. The request is refused, with a
  problem saying to remove the membership first, when the account of any
  person being erased holds a membership in the tenant that is not
  `removed` and has any role other than `applicant`. Staff are removed
  through the normal audited membership flow, under its own permission. So
  the erasure permission gives no power over who has access, and erasure
  can never remove a member of staff, let alone the last tenant admin.
- The request's check is a quick refusal only. The engine checks again
  inside the erasure transaction, with the membership row locked (see
  "Locks"), because a member can be promoted between the request and the
  job.
- Nothing erases automatically: no bulk, threshold or scheduled erasure
  exists. The retention sweep deletes under its own rules and does not call
  this engine. Re-applying the ledger after a restore (below) repeats an
  erasure a named person already made, as recorded in the restored database
  or confirmed row by row by the operator; it is not a new decision. This
  holds erasure to the same standard as rule 9's decisions.

### One erasure across every module

- Each module that holds data about a party exports two contributions from
  its server contract, beside its warehouse contribution (ADR 0016):
  - **erasure:** takes the erasure's subjects (below), takes the tenant from
    the transaction, anonymises those parties' personal data in its own
    schema and returns counts by table, never values;
  - **subject data:** takes one subject party id and yields the party's rows
    with each column's classification, for subject access and export.
- **Subjects.** Before any contribution runs, the engine resolves the named
  party's merge set (the survivor and every party merged into it, ADR 0025)
  and locks every party in it, as set out in "Locks". It then reads, through
  the party contract, each person's
  names, email address and account id as they stand. The subjects passed to
  every contribution are those party ids with these values. The values stay
  in memory: they are never written to a table, job, log, audit event or
  result. A contribution matches on them where it holds no party id, as ADR
  0031's officer rows do, and reaches account-keyed rows through the account
  id.
- The engine runs every registered module's contribution other than party's
  in a fixed order, whether or not the module is switched on for the
  tenant, since a switched-off module keeps its data. Then it runs the
  platform's own step (the membership, below), and party's contribution
  last, so no contribution sees a half-erased party. Finally, for each
  party in the merge set, it destroys the subject key and writes the ledger
  rows, then writes `platform.erasure.completed` with the counts.
- It is one transaction. Any failure, or a result other than counts by
  table, rolls the whole erasure back; `platform.erasure.failed` is then
  written in its own transaction, with a code only.
- A contribution changes data only through approved definer functions of
  its own module ([ADR 0003](0003-query-builder-and-migrations.md#approved-definer-functions)),
  each with its own `NOLOGIN` owner
  ([ADR 0023](0023-function-owner-memberships.md)) and executable by
  `app_worker` only. App roles keep their append-only grants. Platform code
  never queries a module's tables.
- A party already `erased` is skipped with zero counts, so erasing it again
  changes nothing.

### Locks

A guard that reads a party's status when its statement runs misses a write
that overlaps the erasure: an audit write or a portal autosave that read the
status just before the erasure began would commit just after it, putting the
person's data back. So the guards and the engine lock the party row:

- The engine's transaction runs at `READ COMMITTED`. Its first statement
  locks every party in the merge set `FOR UPDATE`, in id order, before it
  reads or changes anything else; it then reads the merge set again and
  starts over if a merge changed it. Every later statement takes a fresh
  snapshot, so it sees each write that held one of those parties before the
  erasure got its lock. An explicit `FOR UPDATE` is needed because the
  erasure's own update of `status` takes only `FOR NO KEY UPDATE`, which
  does not wait for the guards below.
- `party.is_erased(tenant_id, party_id)` reads the status with
  `FOR KEY SHARE`, the lock a foreign key check takes, and holds it to the
  end of the caller's transaction. It is therefore `VOLATILE`. While an
  erasure holds the party it waits, then reads the committed status: at
  `READ COMMITTED` it follows the row to its new version and sees `erased`,
  and at a stricter isolation level the caller fails with a serialization
  error and retries. An erasure that starts after it has returned waits for
  the caller's transaction to end, and then erases whatever that
  transaction wrote. It returns false for a null party id.
- Every guard on the subject's data (see "`erased` is final") calls
  `party.is_erased`, so an overlapping write of the subject's data either
  commits before the erasure starts, and is erased with the rest, or is
  refused. A write the guards let through, such as a status change, holds
  no personal value, so it needs no lock on the party.
- Once the parties are locked, the engine locks the tenant membership of
  each person's account `FOR UPDATE` and checks the staff rule again. A
  membership that is not `removed` and has a staff role fails the erasure,
  and `platform.erasure.failed` is written with a code that tells the
  requester to remove the membership first. A role change updates the same
  row, so a promotion either commits before the check, and the erasure
  fails, or waits and finds the membership removed. A deadlock between the
  two aborts one transaction, and neither outcome removes staff.

### What erasure does to a party

- **In place.** Personal columns of `party.person`, or of
  `party.organisation` for an organisation, are cleared, each to a value its
  existing checks accept. These are every personal column in the party
  core (S03-02):
  - `party.person`: `given_name`, `family_name`, `phone` and `user_id`
    become null. `email` is `NOT NULL` and must look like an address, so it
    becomes `<party id>@erased.invalid`. The `.invalid` top-level domain is
    reserved (RFC 2606), so nothing can be sent to it, and the party id
    makes the value unique to the row, so it never matches another person
    in ADR 0025's email match or in any later unique or matching index.
  - `party.organisation`: `address_line2` becomes null; `address_line1`,
    `address_town` and `address_postcode` take `erased`; and
    `address_country_code` takes `ZZ` (a user-assigned ISO 3166 code, used
    for an unknown country), so the postcode check, which tests the GB
    pattern only for `GB`, accepts `erased`.

  A migration that adds a personal `NOT NULL` column names its erased value
  in the same change, and the erasure function's test proves the column's
  checks accept it. Screens and exports show an erased party from its
  status, never from a placeholder, and matching (ADR 0025) skips erased
  parties.

- **Status.** `party.party.status` becomes `erased` and the database sets
  `erased_at`. The status check is widened to admit `erased`, and a check
  ties `erased` to a set `erased_at`. The row is never deleted while
  referenced: every foreign key into it stays `ON DELETE RESTRICT` and still
  resolves.
- **`erased` is final, and only erasure sets it.** The party erasure
  function's owner is the only role that may move a party into `erased`,
  and nothing, not even an approved function, moves one out. App roles keep
  their column grants (`app_api` may update `status`), so restrictive
  policies `TO` every app role enforce this in the database:
  - on `party.party`, `UPDATE` has `USING (status <> 'erased')` and
    `WITH CHECK (status <> 'erased')`, so an app role can neither mark a
    party erased nor change an erased one;
  - party publishes `party.is_erased(tenant_id, party_id)`, an approved
    definer function that reads only `party.party.status`, under the lock
    set out in "Locks";
  - on every other party table, `UPDATE` applies only to rows whose party
    is not erased, and `INSERT` refuses a row naming an erased party, both
    through `party.is_erased`, so an erased person's names and phone cannot
    be written again and no new relationship, identifier or consent row can
    name them;
  - every table outside the party schema whose subject path (see "Subject
    paths") reaches a party is guarded, whether the path starts at a column
    that references a key party publishes (`party.party`, or
    `party.person` or `party.organisation`, whose rows share their party's
    id, or `party.organisation_snapshot`, through the snapshot's
    organisation) or at a join. A `BEFORE INSERT OR UPDATE` trigger,
    generated from the classification map, calls `party.is_erased` with the
    party the path reaches and refuses:
    - a new row, or a change to the path's own party column, that names an
      erased party, in a table whose path starts at such a column, so no
      application, link, email row or subject key can be added for one;
    - a new row that sets, or an update that changes, a personal or special
      category column of an erased party's row. A column of answers counts
      as personal, since its fields take their classes from the pinned form
      version. So a portal autosave that overlaps the erasure, or a later
      staff edit, cannot write an erased person's answers back.

    An erased person's kept public and internal values, outcomes and
    figures stay as they were. Every other column stays writable, so
    workflow on an erased applicant's application, such as a decision, a
    withdrawal or closing the round, still runs, and a table with no
    personal or special category column, such as `grants.decision_email`
    or `app.subject_key`, has the first guard only. A trigger is used
    because a restrictive policy sees only the new row of an update and
    cannot tell which columns changed. Triggers bind every role, including
    function owners; the module contributions run before party's own step
    sets `erased`, so they pass. `app.audit_event` and `app.erasure_ledger`
    are the named exceptions: they record the erasure itself and never hold
    an erased subject's personal value (see "Audit: per-subject
    crypto-shredding"). The schema lint (S11-55) reads the path the same
    way, so a column referencing any published party key counts as well as
    a join, and fails for a guarded table whose trigger is missing or does
    not cover exactly its party column and its personal and special
    category columns. A foreign key is never moved onto an erased party by
    a merge, because an erased party cannot be merged (ADR 0025).
- **Account link.** `party.person.user_id` is cleared. Staff are refused
  above, and checked again under lock, so the account can hold at most an
  applicant membership in the tenant. If it does, the platform's step
  removes it, using the row the engine locked, as any removal is made:
  status `removed`, the standard `platform.membership.removed` event
  with the requester as actor, and the account's sessions whose active
  tenant is this one revoked (ADR 0010). Its `user_id` is then cleared; the
  membership check allows a null `user_id` only on a removed membership.
  The membership row stays, because audit events and actor columns name it.
  The account, and its memberships in other tenants, are untouched: a
  tenant erases only its own data. Erasing the account is the platform's
  (see "Erasing an account").
- **Snapshots.** Every `party.organisation_snapshot` row of an erased
  organisation has the same personal columns cleared. Snapshots stay
  append-only for app roles; only the erasure function's owner may update
  their personal columns.
- **Value history.** Rows of `party.value_history` (ADR 0025, being drafted)
  for a cleared column lose their old and new values and keep the field id,
  actor and time.
- **Merges.** Erasing a party that was merged, or a party others were merged
  into, erases the survivor and every party merged into it (ADR 0025). Each
  party in that merge set is erased, has its own subject key destroyed and
  gets its own ledger rows, so no merged party's audit values stay readable.
- **Search.** Generated search columns follow the cleared columns. Any
  search value stored separately (ADR 0025) is cleared by the same function.
- **Consent.** Consent rows are kept. They hold ids, codes, a notice version
  and times, so once the person is anonymised they identify no one, and they
  still show that past processing had consent.
- **Suppressions** are the one thing that outlives erasure. A person who
  asked not to be contacted must stay uncontacted, so the tenant keeps the
  minimum needed to honour that. ADR 0033 (being drafted) decides its form,
  such as a keyed hash of an address, and nothing else is kept for it.

### Form answers

- Each field in a form version carries a class: public, internal, personal
  or special category. A field with no class is personal. An application's
  answers take their classes from the `FormVersion` it pinned (rule 7), so a
  later version cannot change what an earlier answer is.
- Erasure removes personal and special category fields, by stable field id,
  from every application whose applicant is the party, and keeps the rest.
  Public and internal answers, scores, decisions, statuses, amounts and
  totals stay, so a round's outcomes and figures do not change. Erasure never
  changes an outcome (rules 8 and 9).
- A file answer is classified like any other field. How its stored object
  is removed is for ADR 0030 (being drafted).
- Decision emails ([ADR 0020](0020-release-emails-without-a-worker.md)) hold
  foreign keys and statuses, not addresses or bodies, and stay as the record
  of who was told what. Nothing is sent to an erased person:
  - Release calls `party.is_erased` for each recipient before writing its
    row, writes no row for an erased recipient, and counts it instead: the
    release audit event records how many recipients were erased, and staff
    see that count beside the round's unsent emails. The decision is still
    released, since erasure never changes an outcome. The call holds the
    party until the release commits, so an erasure that overlaps it either
    waits and then finds the pending row, or has committed first and the
    row is never written. A release that skips the check fails on the
    insert guard rather than queuing an email.
  - The sender marks a pending row for an erased recipient `failed` with the
    code `recipient_erased`, since the party contract returns no address.
    The status is not a personal column, so the guard allows the update. A
    row failed with that code is never sent again.

### Audit: per-subject crypto-shredding

- Erasure changes no audit row. Audit rows are never updated, and only ADR
  0003's purge deletes them.
- An event may keep a personal value only encrypted under the key of the
  event's subject, and only when the value is that subject's own. A personal
  value of anyone else, every special category value, and every value in an
  event with no subject are recorded by field id only, as today.
- **Keys.** `app.subject_key` holds one key per subject party per tenant,
  since each tenant is a separate controller and an erasure in one tenant
  must not touch another:
  - `tenant_id`, and `subject_party_id`, with a composite foreign key to
    `party.party (tenant_id, id)` `ON DELETE RESTRICT` and
    `PRIMARY KEY (tenant_id, subject_party_id)`. A key is identified by its
    subject party id;
  - `wrapped_key`: the 256-bit data key, wrapped by the platform key, and
    null once destroyed;
  - `kek_version`: the platform key version that wrapped it;
  - `created_at`, set by the database, and `destroyed_at`, with a check that
    exactly one of `wrapped_key` and `destroyed_at` is null.
- **Key grants.** App roles have `SELECT` and `INSERT` only on
  `app.subject_key`, so the audit writer gets or creates a subject's key in
  its own transaction; `UPDATE` and `DELETE` have restrictive `false`
  policies, and `INSERT` is refused for an erased party (above). The writer
  calls `party.is_erased` before it reads or creates a key, so it holds the
  party under lock from then to its commit, and records an erased subject's
  values by field id only. A key it creates while an erasure is waiting is
  therefore seen and destroyed by that erasure, and a key it would create
  after one is refused.
- **The platform key** encrypts data keys and nothing else. It is read
  through `readSecret` from a mounted secret, held outside the database and
  never in a database backup. Data keys are wrapped with AES-256-GCM, with
  the tenant id and subject party id as associated data, so a wrapped key
  copied to another row fails to unwrap. The platform key is versioned;
  rotation re-wraps keys through an approved function added with the
  rotation command, as ADR 0010 re-encrypts auth secrets.
- **Values** are encrypted with AES-256-GCM under the subject's data key,
  with a fresh random 96-bit nonce and the event id, field id and side
  (before or after) as associated data, so a value moved to another event or
  field fails to decrypt. The writer therefore generates the id of an event
  that holds encrypted values; the database still sets `occurred_at` and
  `retain_until`. Each value is stored in `changes` as a small versioned
  envelope in place of the plain value.
- **Destruction** goes only through `app.destroy_subject_key(subject_party_id)`,
  an approved definer function with its own `NOLOGIN` owner, executable by
  `app_worker` only. It refuses unless the party is `erased` in the current
  tenant, sets `wrapped_key` to null and `destroyed_at` to now, never deletes
  the row, and writes a `platform.subject_key.destroyed` event with ids only.
  It is idempotent. The engine calls it after every contribution, once for
  each party in the merge set.
- **Readers.** A value whose key is destroyed reads as a fixed "erased"
  result, shown as "Erased": never an error, and never part of a value. A
  value that fails authentication, or names a platform key version the
  deployment does not hold, is an error, logged by code and alerted on,
  because it means tampering or a lost key rather than erasure.
- **Decrypting is a sensitive read.** Only members with a permission of its
  own see decrypted personal values, and each such read writes an audit
  event. Reading the audit log without them stays unaudited, as now.

### The subject party id

- `app.audit_event` gains a nullable `subject_party_id uuid` with no default,
  so adding it rewrites no row. Its composite foreign key
  `(tenant_id, subject_party_id)` to `party.party (tenant_id, id)` never
  cascades or sets null; it is added `NOT VALID` and then validated, which
  scans the table without rewriting it. An index on
  `(tenant_id, subject_party_id)` where it is set serves subject access.
  MVP1 data is synthetic, so nothing is backfilled.
- `insertAuditEvent` and `ctx.audit` take it, from the record the handler
  loaded, never from a request body or URL (rule 6).
- It must be set on every event whose entity is a party, or a row whose
  subject path (below) leads to one, such as an application through its
  applicant or a consent row through its person; on every sensitive read of
  personal data; and on a tenant's copy of an auth event when the account is
  a person in that tenant. Events about configuration, tenants and roles have
  none. The writer refuses an event without one when the entity's table has
  a party subject path.
- It is not encrypted: it is the link subject access follows and the key a
  reader needs. It is classified internal and kept under the tenant's audit
  rule.
- It survives erasure by design. It points at the anonymised party row, so
  the event keeps its meaning and integrity while identifying no one.
- It is the one audit foreign key into a module schema. Party is the master
  record that every module uses, is always on, publishes `party.party` as a
  key under ADR 0016, and never deletes a referenced row, so the key can
  neither dangle nor block the purge, and the database refuses a subject
  from another tenant. Other modules' entities stay as `entity_type` and
  `entity_id`, with no foreign key.
- One subject per event is enough. An event records a change to one entity,
  whose subject path leads to one party, and a value can be encrypted under
  one key only. When one action touches two people's data, such as a contact
  changing their organisation's details or a member of staff acting on an
  applicant, the actor is already in `actor_id`, and the writer writes one
  event per subject whose data changed, each holding only that subject's
  values. A second column or a link table would make every subject query a
  union or a join, and give one event two keys, for no gain.
- Subject access also finds the events a person took part in as an actor,
  through `actor_id`, the membership and its account to
  `party.person.user_id`, until the person is erased.

### Subject paths

- Every classified table whose rows are about a party records, once and
  beside its columns, its path to that party:
  - a column holding a party id, such as `party.consent.person_id` or
    `party.person.id`. A column that references `party.party`,
    `party.person` or `party.organisation` holds one, since those rows share
    their party's id, so an application's applicant column and
    `grants.decision_email`'s recipient are paths of this kind;
  - a named join: a foreign key column to another classified table whose
    path continues, such as a score through its application to the
    applicant, or a column referencing `party.organisation_snapshot`
    through the snapshot's organisation;
  - an account column holding an `auth.user` id, for platform tables such as
    `app.membership`, which reaches a person in a tenant through
    `party.person.user_id`;
  - unlinked, with a stated reason, for personal values that belong to no
    known subject, such as rate-limit counters keyed by a typed identifier or
    an IP address. An unlinked table must have a fixed retention of 12
    months or less.
- A path's column may be null on rows with no known subject, such as an auth
  event for an unknown identifier.
- Subject access, erasure and export are generated from the map by walking
  these paths across modules. The schema lint fails for a table with a
  personal or special category column and no path, for a path naming a
  column that does not exist, for a join that is not a foreign key in the
  catalogue, and for a table outside the party schema whose path reaches a
  party without the erasure guard set out in "`erased` is final" (S11-55).

### Auth events

- `auth.audit_event` keeps typed identifiers and IP addresses in clear for
  its fixed 12 months, under legitimate interests in securing the service
  (UK GDPR Article 6(1)(f) and recital 49). They are already minimised: an
  identifier is kept as typed only if it matches an account or is a valid
  email address, and otherwise as an HMAC; passwords, codes and tokens are
  never kept (ADR 0010).
- They are read only to investigate security events and to answer the
  account holder's own access request.
- A tenant's erasure does not touch them: they are platform records, and
  the tenant's own copies hold ids and codes only. Erasing an account
  (below) does not shorten them either: the account row is anonymised, not
  deleted, so its events keep their foreign key, and their identifiers and
  addresses stay until the purge removes them at 12 months.

### Erasing an account

An account (`auth.user`) belongs to no tenant, so no tenant's erasure
reaches it. The platform holds sign-in data as its own
([ADR 0007](0007-authentication.md)) and erases an account on its
holder's request:

- The platform operator does it through the audited runbook (E12), after
  confirming the request comes from the account holder. A self-service
  request is later work. The runbook calls `auth.erase_user(user_id)`, an
  approved definer function with its own `NOLOGIN` owner, executable only by
  the runbook's role.
- It refuses while the account holds a membership, in any tenant, that is
  not `removed` and has a staff role, as a tenant's erasure does. That
  tenant removes the membership first.
- It anonymises the row in place, since `party.person.user_id`,
  `app.membership.user_id` and `auth.audit_event.user_id` all refer to it
  `ON DELETE RESTRICT`: `name` becomes empty, `email` becomes
  `<user id>@erased.invalid` (which the unique and pattern checks accept),
  `email_verified` and `two_factor_enabled` become false, and `status`
  becomes `erased`. The status check is widened to admit it; like
  `deactivated` it signs no one in, and nothing moves an account out of it.
  The function deletes the account's credentials (`auth.account`), second
  factor (`auth.two_factor`) and every session. Verification and rate-limit
  rows hold only hashes and expire on their own short rules.
- Each of the account's remaining applicant memberships becomes `removed`,
  with `platform.membership.removed` written in its tenant and no actor,
  since the operator acted. The function writes an `account_erased` auth
  event (the code list is widened), copied to each of those tenants.
- It changes no tenant data. Each tenant is the controller of its records
  about the person, who asks each funder to erase them through this ADR's
  engine. Until then the person keeps a `user_id` that points at the
  anonymised row and identifies no one. ADR 0025's merge rule treats a link
  to an erased account as no link, which is the account closure it waits
  on.

### Backups and restores

- **Ledger.** `app.erasure_ledger` records each erasure as ids, codes and
  times only: `id`, `tenant_id`, `subject_party_id`, a `kind`
  (`party_erased` or `subject_key_destroyed`), the erasure's
  `audit_event_id`, and `erased_at` and `retain_until`, both set by the
  database. Each party in a merge set gets its own rows. Rows are kept for
  a fixed 7 years from `erased_at`, the longest backup tier, never under a
  tenant policy.
- **No foreign keys but the tenant's.** `subject_party_id` and
  `audit_event_id` are plain `uuid` columns, as ADR 0025 makes those of
  `crm.merge_record_row`. The ledger outlives its audit event, which the
  12-month purge must stay free to delete, and after a restore it must hold
  rows whose party the restored data lacks. The erasure function checks
  both ids when it writes them. `tenant_id` keeps its foreign key to
  `app.tenant`.
- **Writers.** No app role inserts, updates or deletes a ledger row: all
  three have restrictive `false` policies. `app_worker` holds `SELECT`
  only, to copy rows off-site, and `app_api` holds nothing. Rows are written
  only by the erasure function, in the erasure transaction, and by
  `app.restore_erasure_ledger_row(...)`, an approved definer function
  executable only by the restore runbook's role, never by an app role, which
  inserts one row the operator has confirmed (see "Re-apply") and refuses
  unless the cell is in restore mode. Only the operator's restore command
  sets and clears restore mode, in a row no app role can write, and the API
  takes no traffic while it is set. So forging a ledger row takes operator
  access, and outside restore mode a ledger row never authorises an
  erasure.
- **Purge.** `app.purge_expired_erasure_ledger()`, an approved definer
  function executable by `app_worker`, is the only delete. Like ADR 0003's
  audit purge, it removes only rows past their `retain_until` and writes its
  own audit event with the count.
- **Off-site when written.** The erasure transaction also sends an ids-only
  job (ADR 0009) that writes each new ledger row off-site, one object per
  row named by its id, under a 7-year object lock. It writes with a
  put-only credential of its own, separate from the backup writer's, that
  can create objects in the ledger's bucket but not read, list, replace or
  delete them. It retries until it succeeds, and a row not copied within an
  hour alerts the operator. The
  whole ledger is also copied with each backup manifest. Before restoring
  to any point earlier than the latest, the restore runbook exports the
  current ledger from the live database if it can still be read.
  Point-in-time recovery alone is enough only for a restore to the latest
  point: a restore to an earlier target, such as one that undoes a bad
  migration, would otherwise lose every erasure made after the target. ADR
  0011 (being drafted) must use the copy made when each row is written, and
  this runbook step.
- **Copies are not trusted on their own.** Anyone holding the ledger
  writer's or the backup writer's storage credential could create a ledger
  object naming any party, and the object lock would then keep it for 7
  years. So a row found only in an
  off-site copy (the manifest copies or the per-row objects) or in the
  runbook's export, and not in the restored table, erases no one until the
  operator confirms it:
  - the restore command lists each such row with its ledger id, party id,
    kind, `erased_at`, audit event id and the copies that hold it;
  - the operator checks each row against evidence that storage access
    alone cannot produce, such as the erasure's audit event in the export
    from the live database, or the tenant's confirmation that it asked for
    the erasure, and confirms it by id in the restore runbook;
  - each confirmed row is inserted through
    `app.restore_erasure_ledger_row(...)`, which writes
    `platform.erasure_ledger.row_restored` with the row's ids;
  - an unconfirmed row is not inserted and erases nothing. It is reported
    to the operator as a possible planted object, and stays listed on every
    later restore until its copies expire.

  A keyed check on each object was considered instead, but vanilla
  PostgreSQL has no keyed hash in its core, so either the worker would
  compute it, holding the key, or the database would need an extension and
  a key of its own to escrow; the operator's confirmation needs neither.

- **Re-apply.** After every restore, once the confirmed rows are in, and
  before restore mode ends, `app.reapply_erasure_ledger()`, an approved
  definer function executable by `app_worker` that refuses outside restore
  mode, re-applies each tenant's ledger from the restored table alone:
  - every listed party that is present and not `erased` is erased again by
    the same engine and contributions (not a second implementation). A
    staff membership the restored data still gives that person was removed
    before the original erasure, so it is removed again with the standard
    event; if that would leave the tenant with no admin, re-apply stops for
    the tenant and alerts the operator;
  - every listed key that still exists is destroyed;
  - a party absent from the restore is counted, and its rows kept, so they
    reach every later backup manifest.

  Re-apply is idempotent, writes one `platform.erasure_ledger.reapplied`
  event with counts, and each re-erasure writes its own events.

- **Keys stay out of the long tiers.** The backup leaves `app.subject_key`
  rows out of the data snapshot and writes them, still wrapped, as a
  separate key snapshot taken from the same database snapshot, stored apart
  from the data and kept on the 35-day tier only. Any other copy that holds
  the table in full, such as a provider's automated backups or the
  write-ahead log kept for point-in-time recovery, is kept no longer than 35
  days. A restore loads the newest key snapshot (keys whose party is in the
  restored data), then re-applies the ledger. So a destroyed key stays
  destroyed, and an erased person's audit values are unreadable in every
  copy within 35 days.
- **Escrow.** Each platform key version is held in the deployment's secret
  store and in an offline escrow copy, recorded in ADR 0011's recovery
  runbook. Without it a restore brings back the data but not the personal
  audit values.
- **Tiers.** Off-site copies are kept for 35 days (daily), 12 months (1st of
  the month) and 7 years (1 January), each under object lock, so an erasure
  cannot reach inside them. Erasure takes full effect in a backup only when
  the last copy holding the data expires: up to 7 years for the yearly tier.
  Privacy notices and processing agreements say so in these words:

  > When we erase your personal data, we remove it from our live systems
  > straight away. Our backups cannot be changed, so copies stay in them,
  > kept secure and never used, until each backup expires: daily backups
  > after 35 days, monthly backups after 12 months and yearly backups after
  > 7 years. If we ever restore a backup, we erase your data again before
  > anyone uses the system. Security logs of sign-ins, including IP
  > addresses, are kept for 12 months.

- ADR 0011 (S11-35) is where the tiers, the key snapshot, the escrow, the
  ledger's copy when written and its put-only credential, restore mode and
  the restore steps, including the operator's confirmation of rows found
  only in copies, are recorded, and it must agree with this ADR. If it
  changes a tier, the wording above changes with it.

### Downstream copies

- **Warehouse.** Personal columns never enter it and special category ones
  never can (ADR 0016), so erasure there means only internal rows keyed to
  the party, which the next snapshot shows as an erased party. A later ADR
  that lets a tenant include personal data must say how erasure reaches the
  copies already delivered.
- **The tenant's own copies.** A downloaded snapshot, or a tenant's own
  downstream system, is the tenant's as controller. The engine publishes
  `party.party_erased.v1`, with ids only, as an ADR 0016 event; once the
  outbox in ADR 0034 (being drafted) delivers events outside the process,
  the tenant's copies are told through it.
- **Files.** Job outputs and exports in `app.file` expire on their 7-day
  rule, and erasure does not search them, so an export made before an
  erasure may hold the person's data for up to 7 days.
- **Jobs and logs.** Job payloads hold ids only and last 7 days (ADR 0009).
  Logs and traces carry no personal values, since they are redacted from the
  classification map, so there is nothing to erase in either.

### Until this ADR is accepted

ADR 0003's interim rule stands, as the audit writer in
`packages/db/src/audit.ts` already enforces it: tenant audit events hold
ids, codes and field ids, with values only for public and internal fields,
never personal ones. No code stores a personal value in audit on the
strength of this proposal; encrypted values arrive with the subject keys,
after acceptance.

### Not decided here

- Statutory retention that overrides erasure, such as Gift Aid records,
  legal claims and safeguarding, and legal hold: a later ADR in the first
  quarter of 2027. Until then, a tenant that must keep a record by law
  declines that part of the request outside the system rather than erasing
  in part.
- Tenant offboarding, when a funder leaves and its whole tenant is deleted,
  is a separate path and not this ADR's.

## Consequences

- Rule 2: `app.subject_key` and `app.erasure_ledger` have `tenant_id`, are
  set up with `app.enable_tenant_rls()`, and each ships with a cross-tenant
  denial test, as does each erasure function. Denial tests also prove that
  an app role cannot move a party into or out of `erased`, update an erased
  party's rows, or insert a relationship, identifier, consent, subject key or
  module row naming an erased party, including a row in a table keyed to
  `party.person` rather than `party.party`, such as an application or a
  decision email; that it cannot change a personal or special category
  column, such as an application's answers, of an erased party's row, but
  can still change a workflow column, such as that application's status,
  and mark a pending decision email to an erased person `failed`; that
  releasing a round with an erased recipient commits, writes no email row
  for them and counts them; that no app role can insert,
  update or delete a ledger row; that the re-apply and row restore
  functions refuse outside restore mode, the row restore function refuses
  every app role, and the erasure functions refuse a ledger row as
  authority outside restore mode; that re-apply erases no party named only
  in an off-site copy or export until its row is confirmed; and that
  erasure, in a tenant or of an account, refuses a person with a staff
  membership.
- Concurrency tests, with two sessions, prove the locks: an audit write
  that has called `party.is_erased` before an erasure starts leaves no live
  key once the erasure commits, and one that calls it while the erasure
  holds the party is refused; a portal autosave of personal answers that
  overlaps an erasure either commits first and is cleared, or is refused;
  a workflow update of the same application that overlaps an erasure
  commits and leaves the answers cleared; a release that overlaps an
  erasure either writes the recipient's row first, which the sender then
  marks `failed`, or skips and counts the recipient; and a promotion to a staff role racing the erasure ends with either the
  erasure failed or the membership removed, never a staff membership
  removed.
- Rule 3: the subject key and audit subject reach `party.party` by
  composite foreign keys. The ledger's party and audit event ids are the
  named exception, plain `uuid`s checked when written, for the reasons
  above. Checks admit `erased` on parties and accounts, tie a party's
  `erased` to `erased_at` and a destroyed key to `destroyed_at`, and allow a
  null membership `user_id` only when removed.
- Rule 4: every erasure, key destruction, membership removal, account
  erasure, restored ledger row, ledger re-apply and ledger purge writes an
  audit event in the
  same transaction as its change. App roles keep `INSERT` and `SELECT` only
  on both audit tables; the only new writers are approved definer
  functions, listed in ADR 0003's table when they land.
- Rule 5: every new column is classified with a retention rule.
  `subject_party_id` is internal under the audit rule; the subject key
  columns are internal and kept with the party, with the key itself gone
  once destroyed; the ledger is internal, kept 7 years from `erased_at`;
  `erased_at` is internal and kept with the party. Each classified table
  records its subject path.
- Rule 6: the actor comes from the session, and the server re-validates
  every erasure request with the shared domain package.
- Rule 9: erasure happens only on a named member's request, after step-up,
  and an account's only on its holder's request through the operator's
  audited runbook. After a restore, only a ledger row in the restored table
  or one the operator confirmed re-erases anyone.
- New contracts entry points that build on this ADR, such as S11-45's
  retention, subject access and erasure contracts and S11-53's `privacy`
  contracts, import the jitless zod switch
  (`packages/domain/src/jitless`) first.
- Every migration that adds a table holding personal data adds its module's
  erasure function, and the module adds its two contributions.
- Costs we accept: a platform key with escrow and rotation, whose loss makes
  every personal audit value unreadable; a decryption per personal audit
  value read; no search over personal audit values; a separate key snapshot
  in every backup; and erased data that stays in locked backups for up to 7
  years, which privacy notices must say.
- This ADR amends ADR 0003 (it answers "Erasure is not yet designed", and
  adds definer functions to its table), ADR 0017 (status `erased`, final
  and set only by erasure; the account link on erasure), ADR 0010 (account
  erasure, the account status `erased` and the `account_erased` event),
  ADR 0020 (release writes no email row for an erased recipient and counts
  it instead, and the sender marks an existing pending row for one `failed`
  with `recipient_erased`, through the status update the guard allows) and
  ADR 0025 (the account closure its merge rule waits on). Their status
  lines change in a later housekeeping change.

## Dependency check

No dependency is added. Keys, nonces and AES-256-GCM come from `node:crypto`.
