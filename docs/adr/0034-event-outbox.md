# ADR 0034: Event outbox

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

[ADR 0016](0016-modular-suite-and-shared-warehouse.md) chose pg-boss jobs
for events between modules (its option 4): publishing sends one job per
subscribing module, through [ADR 0009](0009-background-jobs.md)'s send
helper, in the publisher's transaction. Jobs are deleted 7 days after they
finish, so ADR 0016 says events "are not a history", and adds: "If we later
need ordered replay, or delivery outside the process such as webhooks, a
new ADR adds an outbox table."

That need has arrived. `connect` (wave 2) delivers a tenant's events to its
own systems as webhooks, which needs a stable order and a way to send again
what a receiver missed. The later incremental warehouse feed (ADR 0016) and
the notice to a tenant's own copies after an erasure
([ADR 0027](0027-erasure-across-modules-and-audit.md)) need the same.

Constraints:

- Every tenant-owned table has `tenant_id`, row-level security and a
  cross-tenant denial test ([rule 2](../ARCHITECTURE.md)). The pg-boss
  schema is the one exception, and only with ADR 0009's guards.
- Work across tenants is a scheduled platform job that lists tenants
  through `app.tenant_ids()` and works inside each tenant's context
  (ADR 0009).
- Plain PostgreSQL 16 and Node.js; no cloud queue or log service (rule 1).
- Payloads hold ids, enums, integers and timestamps only (ADR 0009), so
  erasure has nothing to find in them (ADR 0027).
- Outbound HTTP goes through one dispatcher that allows only public
  addresses over HTTPS ([ADR 0010](0010-authentication-security-rules.md)).

## Options considered

Where events are kept:

1. **pg-boss only, as now.** No order across queues, no replay once a job
   is deleted, and no record for a consumer that did not exist when the
   event was sent.
2. **An outbox table written by the same publish call.** One more insert per
   event, in the same transaction; a relay reads it in order.
3. **Logical decoding of the write-ahead log.** Bypasses row-level security
   and classification, needs replication rights, and differs between
   providers.
4. **LISTEN and NOTIFY.** Lost on restart, with no order across sessions.

How each tenant's sequence is numbered:

5. **One global PostgreSQL sequence.** Never blocks, but a number is taken
   when the row is inserted, not when it commits: a reader can see event 11
   committed while event 10 is still in flight, and step past 10 for good
   unless it also tracks transaction ids. The gaps also tell one tenant's
   webhook receiver how busy other tenants are.
6. **A counter row per tenant, incremented in the publishing transaction.**
   The row lock, held to commit, makes numbers follow commit order within a
   tenant, so a reader that has seen N has seen everything before N.
   Tenants never wait for each other. The cost: one tenant's publishing
   transactions commit one at a time from their publish onwards.
7. **A PostgreSQL sequence per tenant.** The same insert-time problem as
   option 5, and DDL for every new tenant, which the app roles cannot run.
8. **Numbers assigned later by the relay.** No lock when publishing, but
   the relay would need to update outbox rows, or a second table to hold
   the numbers.

## Decision

Options 2 and 6. This amends ADR 0016 on one point only: events are now
also kept, in order, in a tenant-owned outbox for a fixed 90 days. Everything
else in ADR 0016's "Calls and events" stands: events still travel as
pg-boss jobs to in-process subscribers, handlers are idempotent and read
current state through the owner's contract, and the outbox does not replace
pg-boss.

### Written by publish

- `publish()` in `packages/db/src/jobs/` (S11-56) writes one
  `app.event_outbox` row and sends the subscribers' jobs, in the caller's
  transaction. An event exists only if the change commits: a rollback
  removes the row and the jobs together, and the job send cannot succeed
  while the outbox write fails, since both are statements in one
  transaction.
- `publish()` takes no tenant argument; it reads the tenant from the
  transaction and refuses when none is set. Every event is a fact in one
  tenant. Platform work across tenants is a scheduled job, not an event.
- Modules never write the table directly. Only `publish()` names it: each
  module's database types are generated per schema, so module code has no
  type for it, and a Semgrep rule bans the table's name anywhere else.
- Every published event is written, whether or not anything subscribes and
  whether or not the module is switched on for the tenant.

### Tables

All three are tenant tables under
[ADR 0003](0003-query-builder-and-migrations.md), set up with
`app.enable_tenant_rls()`.

| Table                | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | App role rights                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.event_outbox`   | `tenant_id`; `id`, the event id `publish()` generates, also carried by its jobs; `sequence`; `type`, the versioned event name such as `grants.decision_released.v1`, checked against the name pattern; `payload`, a JSON object under a size cap; `occurred_at`, set by the database; `request_id`; `caused_by`, the membership whose action caused it, null for the system, with a composite foreign key to `app.membership`; `retain_until`, set by the database. Primary key `(tenant_id, id)`, unique `(tenant_id, sequence)` | `app_api` and `app_worker`: `INSERT` on the columns `publish()` writes and `SELECT`; `app_worker` also deletes expired rows (below)                                                                                                                           |
| `app.event_sequence` | `tenant_id` (primary key), `last_sequence`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `app_api` and `app_worker`: `SELECT`, `INSERT`, and `UPDATE` of `last_sequence`, which only the numbering trigger uses                                                                                                                                        |
| `app.event_cursor`   | `tenant_id`, `consumer` (a checked code), `last_sequence`, `updated_at`. Primary key `(tenant_id, consumer)`                                                                                                                                                                                                                                                                                                                                                                                                                      | `app_worker`: `SELECT`, `INSERT`, and `UPDATE` of `last_sequence` and `updated_at`; `app_operator` (ADR 0024): `SELECT` and `UPDATE` of the same columns, and `SELECT` of `sequence` and `retain_until` on `app.event_outbox`, for replay; `app_api`: nothing |

`app.event_outbox` is otherwise append-only for app roles: no role has an
`UPDATE` grant, `UPDATE` has a restrictive `false` policy for every app
role, and `DELETE` has one for every app role except `app_worker`.

### Order

Decided: option 6.

- A `BEFORE INSERT` trigger on `app.event_outbox` increments the tenant's
  `app.event_sequence` row, creating it at 1 on the tenant's first event,
  and sets `sequence` from it, whatever the caller supplied. A trigger on
  the counter allows app roles only an increase of one.
- The counter row stays locked until the publishing transaction ends, so a
  second publisher in the same tenant waits, then reads the committed value
  (at `READ COMMITTED`; at a stricter level it fails with a serialization
  error and retries, as ADR 0027's guards do). So within a tenant, numbers
  follow commit order and a rolled-back event gives its number back.
- Consumers rely on two things only: events arrive in `sequence` order, and
  once a consumer has seen N it has seen every retained event before N.
  They never rely on numbers being consecutive. Gaps appear when retention
  removes old rows, and after a restore (below); the relay passes a gap
  without waiting, since no earlier number can still commit.
- **The cost.** Publishing transactions in one tenant commit one at a time
  from their publish onwards. Handlers therefore call `publish()` as their
  last write, so the lock is held for little more than the commit, and
  review checks this. A tenant's busiest moment, a deadline day of
  submissions, is far below what one row lock per commit allows. Two
  transactions that publish and also lock the same rows in opposite orders
  can deadlock; PostgreSQL aborts one, and it is retried like any
  serialization failure.
- **Restores.** A restore to an earlier point turns the counters back with
  the data, while receivers outside may already hold later numbers. ADR
  0011 (being drafted) adds a restore step that moves each tenant's counter
  forward by a fixed margin, in restore mode (ADR 0027), so no number sent
  out before the restore is reused. Receivers see a gap, which they
  tolerate.

### Retention and deletion

- Outbox rows are kept for 90 days from `occurred_at`. A `BEFORE INSERT`
  trigger sets `retain_until` whatever the caller supplies, and a `CHECK`
  keeps it at least 90 days after `occurred_at`. The value is fixed in the
  classification map as a platform rule: no tenant setting raises or lowers
  it. It is longer than pg-boss's 7 days so that a receiver that has been
  down for weeks, or a consumer added later, can still catch up.
- Expired rows are deleted as
  [ADR 0028](0028-idempotency-keys.md#deleting-expired-rows) deletes
  expired keys: a per-tenant job of the retention sweep, as `app_worker`,
  runs plain `DELETE` statements in batches of at most 10,000 rows. The only
  permissive `DELETE` policy is
  `TO app_worker USING (tenant_id = app.current_tenant_id() AND retain_until < now())`,
  so not even the sweep can remove a row inside its retention. As with
  ADR 0028's purge, the deletion writes no audit event; it counts rows in
  telemetry.
- This adds `app.event_outbox` to the tables that carry ADR 0028's variant
  of ADR 0003's rule 4 (`app_worker` may delete expired rows). It is not
  ADR 0003's audit retention exception and does not copy it: no definer
  function deletes, and the audit log stays as it is.
- Counter and cursor rows are kept for the life of the tenant; a counter is
  never reset, so numbers keep rising after old rows are deleted.
- A suspended tenant is not listed by `app.tenant_ids()`, so its rows wait
  until it is active again, as ADR 0028 notes for its keys.

### Relay

- A scheduled platform job runs every minute. It lists tenants only through
  `app.tenant_ids()` and, for each, sends one per-tenant relay job from
  inside that tenant's context (ADR 0009). Its payload holds no tenant
  data.
- The per-tenant relay runs through ADR 0009's handler wrapper, as
  `app_worker` with the payload's tenant set. For each registered consumer
  it locks the consumer's cursor row, reads at most 500 rows with a higher
  `sequence` in order, hands each to the consumer by sending a job holding
  the event's id to the consumer's own tenant queue, and moves the cursor to
  the last row handed over, all in one transaction. A rollback leaves the
  cursor where it was.
- One relay runs per tenant and consumer at a time (a singleton key with
  the tenant, as ADR 0009 requires). A failing consumer keeps its cursor and
  does not hold up the others or other tenants.
- The relay re-validates each payload against its event's schema before
  handing it over. A row that fails stops that consumer's cursor before it
  and logs a code.
- The outbox is tenant-owned, with `tenant_id`, row-level security and a
  cross-tenant denial test for each table. The relay reads one tenant at a
  time from inside that tenant's context. This ADR adds no exception to
  rule 2, and no definer function.

### Cursors and replay

- `app.event_cursor` holds one position per consumer per tenant. A missing
  row starts before the oldest retained event. Consumer codes are a checked
  list, widened by the migration that adds a consumer, and match the
  relay's registry of consumers in code.
- Delivery is at least once: a crash after a consumer's job ran but before
  its effects were recorded runs it again. Handlers are idempotent, keyed by
  the event id, as ADR 0016 already requires.
- A trigger lets `app_worker` only move a cursor forward. Moving one back is
  a replay, and only `app_operator` may do it.
- **Replay** is an operator action, through one command,
  `apps/api/src/operator/replay-events.ts`. The operator names a tenant,
  a consumer and a start position. The command lists tenants through
  `app.tenant_ids()` as `app_worker` and refuses unless the named tenant is
  among them; the tenant it sets is the entry `app.tenant_ids()` returned,
  never the operator's argument. It sets that tenant through
  [ADR 0019](0019-tenant-addresses-public-pages-and-theming.md)'s operator
  helper and switches to `app_operator` through
  [ADR 0024](0024-no-tool-on-by-default.md)'s role helper, as ADR 0024's
  backfill command does. This is a new entry in ADR 0003's list of tenant
  sources, in this command only, and ADR 0003's limit of the fan-out to the
  scheduler's platform job and ADR 0019's limit of the operator helper
  widen to it. The Semgrep rules that enforce those limits admit this file
  and nothing else, and their tests hold a use in another file under
  `apps/api/src/operator/` that must fail. A suspended tenant is not
  listed, so it cannot be replayed until it is active again.
- The replay names one consumer and a start position, never earlier than the oldest
  row still within retention; the trigger refuses anything earlier, and
  refuses a start beyond the current cursor. In the same transaction the
  command writes `platform.event_cursor.rewound` with actor kind
  `operator`, the request id, the consumer code and the range (from the
  start to the cursor's old position), and nothing from any payload. The
  request id ties the event to the named operator in the operations log
  (E12). Ordinary cursor moves are not audited one by one; the relay counts
  them in telemetry.
- When `connect` lets a tenant admin re-send their own webhooks, that is a
  member's action under a `connect` permission, audited with the
  membership, and `connect`'s ADR decides it.

### Payloads and classification

- A payload holds ids, enums, integers and timestamps only, validated
  against its event's `defineEvent` schema (S11-29) by `publish()` before
  the insert. Consumers read current state through the owner's contract,
  never from the payload. A database check refuses a payload that is not a
  JSON object or is over the size cap.
- **No restricted values.** The outbox keeps every event for 90 days and
  feeds webhooks and the warehouse, whatever the reader's permissions, the
  release state or the round's blinding. So no event carries an outcome, a
  score, a recommendation, an eligibility result or any other value whose
  read is restricted by a permission, by release state (rule 8) or by blind
  review. Such an event carries ids only, for example
  `grants.decision_recorded.v1 { decisionId, applicationId }`, and a
  consumer reads the value through the owner's permission-checked contract,
  which applies release and blinding. An enum or integer is allowed only if
  everyone who may read the event may see it at every moment the event
  exists.
- Each `defineEvent` names the permission needed to read the event, and its
  review checks every payload field against the rule above. S11-29's tests
  fail if an event lacks a read permission, or if a payload field reuses a
  schema that a contract marks restricted (the decision outcome, rubric
  score and recommendation schemas among them).
- Every column of the three tables is classified as internal, since none
  holds a name, address, answer or free text. Outbox rows are kept for the
  fixed 90 days; counter and cursor rows for the life of the tenant.
- Erasure changes no outbox row. An event naming an erased person keeps
  ids that now point at the anonymised party (ADR 0027), and expires on its
  90-day rule. `party.party_erased.v1` reaches the tenant's own copies
  through the outbox once `connect` delivers it.

### Webhook envelope for `connect`

`connect` builds subscriptions and delivery in wave 2. Nothing about them is
built now; this fixes what they will send, so the outbox and event
contracts are shaped for it.

- **Envelope.** A JSON object with exactly: `id` (the event id, which
  receivers use to drop duplicates), `type` (the versioned name),
  `sequence` (the tenant's number), `occurredAt` (an RFC 3339 timestamp) and
  `data` (the ids-only payload). The internal envelope of S11-29 also
  carries the tenant, request and causing member ids for audit; the webhook
  leaves them out, since a subscription already belongs to one tenant.
- **Signing.** HMAC-SHA-256 with a random 32-byte secret per subscription,
  over the event id, a timestamp and the exact body, sent in
  `webhook-id`, `webhook-timestamp` and `webhook-signature` headers, so
  receivers can use existing verifiers for the Standard Webhooks scheme
  (GK: confirm the current version of the scheme before `connect` builds
  it). Receivers reject a timestamp more than 5 minutes from their clock.
  The secret is shown once, stored encrypted as ADR 0010's adapter stores
  SSO secrets, and rotated with an overlap during which both signatures are
  sent.
- **Delivery.** Through the outbound dispatcher of ADR 0010: HTTPS only, to
  public addresses checked at connect time on every attempt. A `2xx` within
  10 seconds is success; a redirect is a failure and is not followed; the
  response body is discarded.
- **Retries.** Eight attempts: at once, then after 1 minute, 5 minutes,
  30 minutes, 2 hours, 6 hours, 12 hours and 24 hours, with jitter. Then
  the delivery is marked failed, and the tenant can re-send it while the
  event is within retention. Events are attempted in sequence order per
  subscription, but a failing event does not hold up later ones; receivers
  order by `sequence`.

### Not the module outboxes

Module outboxes such as `grants.decision_email`
([ADR 0020](0020-release-emails-without-a-worker.md)) record messages to
people, with real foreign keys to the person and the record, and are kept
as long as that record. Every module that sends email keeps its own, and
the consent check sits between it and the sender
([ADR 0033](0033-consent-and-communications.md)). The event outbox records
facts for systems, holds ids only and expires after 90 days. Neither
replaces the other, and nothing sends email from the event outbox.

### Not decided here

- Webhook subscriptions, their screens, per-subscription positions and the
  disabling of failing endpoints: `connect`'s ADR in wave 2. That ADR must
  deliver an event type only to subscriptions whose creator holds the
  event's read permission, checked when the subscription is made and again
  at each delivery, and the warehouse feed reads values only through the
  owners' contracts.
- The incremental warehouse feed: `insight` v1.1.
- A faster relay than once a minute, for example a relay job sent by
  `publish()`: added only if `connect` needs lower latency.

## Consequences

- Rule 1: plain PostgreSQL tables and pg-boss; no cloud queue or log
  service, and webhooks go out over plain HTTPS.
- Rule 2: the three tables have `tenant_id`, forced row-level security and
  cross-tenant denial tests: tenant A's relay reads none of B's events and
  cannot move B's cursors, a replay for A cannot reach B, and a publish in
  A cannot number or write an event in B. No new exception to rule 2.
- Rule 3: `type` and `consumer` are checked; `caused_by` references
  `app.membership` by composite foreign key; `sequence`, `retain_until`
  and `occurred_at` are `NOT NULL` and set by the database.
- Rule 4: a replay writes an audit event with the operator, the consumer
  and the range, with ids and codes only. Publishing writes none of its own,
  since the change that published already did.
- Rule 5: every column is classified with a fixed retention.
- Rule 8 and blind review: no event carries an outcome, score,
  recommendation or other restricted value, so neither the outbox nor
  anything it feeds can reveal one before release or in a blind round.
- Rule 9: the outbox only records and forwards ids. Nothing in it decides,
  and a replay is an operator's named action.
- Tests prove that a rolled-back publish leaves neither row nor job, that
  two concurrent publishers in one tenant get numbers in commit order, that
  two tenants never wait for each other, that `app_worker` cannot move a
  cursor back and `app_operator` cannot move one before retention, that
  no app role can update an outbox row or delete one inside its retention,
  that the replay command refuses a tenant `app.tenant_ids()` did not
  return, and that no defined event has a restricted payload field or lacks
  a read permission.
- `packages/domain/src/events/` (S11-29), the first contracts entry point
  built on this ADR, imports the jitless zod switch
  (`packages/domain/src/jitless`) first and is covered by the jitless test.
- Build order: event contracts (S11-29), the publish helper (S11-56), the
  tables and the outbox write in `publish()` (S12-61), then the relay and
  replay (S12-72).
- Costs we accept: one insert and one counter update per event; publishers
  in one tenant serialise from their publish to commit; 90 days of event
  rows per tenant; and a restore step that moves counters forward.
- This amends ADR 0016 (events are also kept in the outbox for 90 days; its
  outbox sentence is answered here), ADR 0024 (`app_operator` gains the
  cursor grants above), ADR 0003 (ADR 0028's expired-row delete rule covers
  one more table) and ADR 0019 (its operator helper takes one more command).
  ADR 0003's tenant sources and ADR 0024's operator helper widen to the
  replay command. Their status lines change in a later housekeeping change.

## Dependency check

No dependency is added. HMAC-SHA-256 comes from `node:crypto`, and the relay
uses pg-boss as ADR 0009 pinned it.
