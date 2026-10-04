# ADR 0028: Idempotency keys

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0004](0004-api-contract.md) sets the API contract but is silent on
retries and duplicate creates. A person who presses "Submit application"
twice, or whose connection drops after the server has created a record but
before the answer arrives, sends the same create twice and gets two records.
For the same reason `call()` cannot safely retry a `POST` on its own. This ADR
closes that gap and amends ADR 0004. Gate 1 depends on it: idempotency keys on
create routes are item 5 of the work agreed on 3 October 2026 for before
Gate 1.

Constraints:

- The acting user and tenant come from the session, never from the request,
  and request schemas never name a tenant or an actor
  ([architecture rule 6](../ARCHITECTURE.md), ADR 0004).
- Problem details never echo a submitted value (ADR 0004).
- Every tenant-owned table has `tenant_id` and forced row-level security, and
  every column is classified
  ([ADR 0003](0003-query-builder-and-migrations.md), rules 2 and 5).
- A replay must not show more than a fresh read would. Blind review and
  private decisions (rule 8) hold for replays too.
- Rate limits on public, probe and general routes need a store that every API
  instance shares. PostgreSQL is the only shared store we run
  ([ADR 0009](0009-background-jobs.md) ruled out Redis).

## Options considered

1. **An `Idempotency-Key` header, with a key store in PostgreSQL scoped to
   tenant, member and route.** The pattern of the IETF HTTP APIs working
   group's Idempotency-Key header draft and of the large payment APIs. One
   mechanism for every create route, and the key travels outside the
   validated body, so request schemas do not change. Costs one tenant table
   and a purge job.
2. **Client-chosen ids, with `PUT` to a uuid the client makes.** Idempotent by
   nature, but it changes every create route's method and URL, lets clients
   choose primary keys, and does not cover a create that writes several rows.
3. **Natural unique constraints only**, such as one draft per applicant and
   programme. We keep them where the domain has one, but most creates (an
   invitation, a note, an organisation) have none, and a duplicate gets a
   conflict rather than the first result.
4. **Disable the button and do nothing on the server.** Stops a double click,
   not a lost response.

Within option 1:

- A key reused with a different request: `409`, or `422` as the IETF draft
  uses.
- A request whose key is still held: `409`, or `425 Too Early`.
- The reservation: inside the request's transaction, or committed first in a
  transaction of its own.

## Decision

Option 1. This amends two ADRs, each left as it is until this ADR is
accepted, when it gains an "Amended by ADR 0028" line:

- ADR 0004's "Contracts", "Errors" and "OpenAPI and clients" sections, for
  the header, the marker and the two problems.
- ADR 0003's "Row-level security" section. Its allowlist gains
  `app.request_limit`. Rule 4 gains one variant: on `app.idempotency_key`
  and `app.request_limit`, `app_worker` may delete expired rows, so their
  restrictive `DELETE` policy names every app role except `app_worker`. Its
  "Checks" gain the checks under "Deleting expired rows" below. No definer
  function is added, so its approved definer functions table, the roles
  script and the function owners are unchanged.

### The header

- The key travels in the `Idempotency-Key` request header. Its value is a uuid
  of version 4 or 7 in the canonical 36-character form, in either case. The
  server lower-cases it.
- A missing key on a route that requires one, or any other value (the nil
  uuid, another version, braces, a quoted string), is a `400` validation
  problem on the field `header.idempotency-key`. Like every problem, it does
  not echo the value.
- The key is never a body field, query parameter or path segment.
  `checkRoute()` refuses a request schema with a key named for it, as it
  refuses tenant and actor fields. Request schemas still never name a tenant
  or an actor.
- The IETF draft sends the key as a quoted structured-field string. We take
  the bare uuid, which needs no quoting, and `openapi.json` documents it.

### Which routes

- Every `POST` that creates, meaning it answers `201`, is marked
  `idempotent: true` in its contract, in every audience and every module.
  `checkRoute()` refuses a `201` `POST` without the marker, the marker on any
  other method, and the marker on an `auth` route. S11-14 builds this.
- `auth` routes stay outside. Better Auth owns them, they have no membership
  to scope a key to, and [ADR 0010](0010-authentication-security-rules.md)
  already guards their repeats with single-use tokens, email-first sign-up and
  rate limits.
- A `POST` that creates nothing may opt in, and should when a repeat would act
  twice (sending a message) or when a lost response would show a person an
  error for something that worked: a second "Submit application" or "Release
  decisions" meets its state check and answers a conflict. An opted-in route
  keeps every rule below.
- Public routes have no session and so no membership. ADR 0036 (anonymous
  public submissions, being drafted) settles how their keys are scoped. Until
  it is accepted, the API refuses to register an idempotent public route, so
  no public route creates.

### Scope of a key

- A key is unique per tenant, membership and route id. The tenant is the
  request transaction's, set from the session's active tenant. The membership
  is the one the policy module resolved from the session. Neither comes from
  the request.
- The route id is the contract's method and path template, such as
  `POST /portal/applications`. It is unique across the API, already in every
  contract, and needs no new name.
- The same key on another route, from another member or in another tenant is
  a different key: a fresh request, never a replay.
- Row-level security separates tenants. It does not separate members, since
  the tenant context holds no membership. Member scoping rests on the unique
  key and on every lookup naming the session's membership, and tests prove
  both.

### What is stored

`app.idempotency_key` is a tenant table with these columns:

- `tenant_id` and `id`, as in every tenant table;
- `membership_id`, the member who sent the key;
- `route_id`, checked against its format;
- `key`, the uuid in lower case;
- `request_hash`, 32 bytes: SHA-256 of the canonical request;
- `state`, `in_progress` or `completed`;
- `status`, the `2xx` status sent, null while in progress;
- `created_id`, the id of the resource the response reads: the one created,
  or for an opted-in route the one it acted on. It is null while in
  progress, or when the route answers no body. It is not a foreign key,
  since the resource lives in a different table for each route;
- `created_at` and `expires_at`, set by the database whatever the caller
  supplies.

Further rules:

- The canonical request is the UTF-8 JSON text of an object with the members
  `route` (the route id, which carries the method), `params`, `query` and
  `body`. Each part is the value its request schema returned after
  validation, or null where the route has none. Object members are sorted by
  name at every level, there is no whitespace, and values are written as
  `JSON.stringify` writes them. It is built from validated values, never raw
  bytes, so member order and spacing do not change it. Path parameters are
  part of it, so one key sent to two different applications' submit routes is
  a mismatch, not a replay.
- The hash is plain SHA-256, not keyed. It is never returned or logged, and is
  compared only for the member who sent the key, so the API offers no way to
  test guesses of a value against it. The values it digests are already in
  the database, in the resource the request created. It is still classified
  as personal, since it derives from values that may be.
- Nothing else is kept: no response body, no request value, no other header,
  no IP address.
- A replay answers the stored status, with a body that the route's replay
  reader reads afresh through the same audience projection, scope rule and
  blind-review settings as a fresh read, for the member as they are now. If
  they can no longer read the resource, the replay answers `404`, as a fresh
  read would. A cached body could hold fields the caller has since lost
  access to, so none is kept.
- A replay writes no row and sends no job. It is audited only where a fresh
  read of the same resource would be.

### Reservation

The order for an idempotent route:

1. The session, the request schemas and the key are validated, then the
   policy module checks permission and scope. A caller without permission
   never reaches the key store.
2. Inside the request's tenant transaction, before the handler runs, the
   middleware inserts the row as `in_progress` with
   `ON CONFLICT (tenant_id, membership_id, route_id, key) DO NOTHING`, under a
   lock timeout of 5 seconds on that statement alone.
3. If the row was inserted, the handler runs, and the same transaction marks
   the row `completed` with the status and the created id. The reservation,
   the resource and the completion commit together or not at all.
4. If no row was inserted, the middleware reads the row by its full unique
   key. The same hash means a replay; a different hash means the reused-key
   problem.
5. If the lock timeout expires, it answers the in-progress problem.

PostgreSQL's unique index makes a second insert of the same key wait for the
first transaction to end. If the first commits, the second insert does
nothing, and the next statement sees the committed row, since requests run at
`READ COMMITTED`, PostgreSQL's default. If the first rolls back, the second
inserts and runs the handler. So two identical requests in flight create one
key row and one resource, and the loser gets the replay or the in-progress
problem, never a second `201`.

Other requests never see an `in_progress` row, because it commits only as
`completed`. The state exists so that a row is complete only once the
handler has finished, and a check ties `status` and `created_id` to it. A
route whose work spans more than one transaction cannot be idempotent under
this ADR and needs its own design.

Any error from the handler, including a problem it raises on purpose, rolls
back the transaction and the reservation with it, so the client can retry
with the same key. Only success is remembered.

We rejected committing the reservation first in its own transaction. It
would show `in_progress` to other requests without a wait, but a crash
between the two transactions would leave the key stuck for its whole expiry
and block the person's retry.

### Problems

Two new problem types, the first that are not `about:blank`:

| Type                                    | Status                       | When                                                    |
| --------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `/problems/idempotency-key-reused`      | `409`                        | The same key, member and route with a different request |
| `/problems/idempotency-key-in-progress` | `409`, with `Retry-After: 5` | The reservation waited 5 seconds for another request    |

- The type URIs are relative to the API's origin. Each deployment and each
  self-hosted install has its own origin, and an absolute URI would name one
  host or brand. A page explaining each problem can live at its path later.
- The reused key is a `409`, not the draft's `422`. The request is valid; it
  conflicts with what the key already stands for. Our `422` means a request
  the person can fix by editing it, whereas here the fix is a new submission
  with a new key.
- The in-progress problem is a `409` with `Retry-After`, as the draft uses,
  not `425`. RFC 8470 defines `425 Too Early` for requests sent in TLS early
  data, and clients and proxies may act on it as such.
- The two share a status and differ by `type`, which the apps read.
- Neither echoes the key, the hash, the created id or any request value. Their
  titles and details come from the domain package's message catalogue and
  follow the [content style guide](../CONTENT-STYLE.md).

### Expiry

- A database trigger sets `expires_at` to `created_at` plus 24 hours.
- A row past `expires_at` that the purge has not yet removed still answers as
  before. The 24 hours is the least a client can rely on.
- A worker job purges expired rows under ADR 0009. A platform schedule fans
  out through `app.tenant_ids()` every hour, one job per tenant with ids only
  in its payload. Each job runs, as `app_worker` in the tenant's
  transaction, a plain `DELETE` of at most 10,000 rows whose `expires_at` has
  passed, chosen by key in a subquery with a `LIMIT`, and repeats until a
  batch deletes none. It logs the count and stores error codes only. The
  rights it needs are under "Deleting expired rows".
- Every column has a fixed retention of 2 days from `created_at`: the expiry
  plus a margin for the purge.
- Once a key is purged, the same request counts as new. `call()` retries
  within seconds and screens keep a key only for one submission, so this
  affects only a client that retries a day later.

### Clients

- For an idempotent route, `call()` makes one key per call with
  `crypto.randomUUID()`, a version 4 uuid, and sends the same key on its own
  retries: after a failure to connect, or a `502`, `503` or `504`, at most
  twice. It never retries a route that is not idempotent, any other status,
  or either problem above.
- `ProblemError` carries the key used. A screen that offers "Try again" for
  the same submission passes it back; a new submission gets a new key. After
  the reused-key problem the screen starts a new submission.
- A key is not a secret, but it is not shown or logged either.

### `app.request_limit`

- A store for the counters behind rate limits on public, probe and general
  routes (S11-36), shared by every API instance. It follows the pattern of
  `auth.rate_limit` (ADR 0010).
- It is not tenant-owned and has no `tenant_id`. Its columns are `bucket`,
  checked against a fixed list of limit names; `key_hash`; `window_start`;
  `count`, never negative; and `expires_at`. The primary key is
  `(bucket, key_hash, window_start)`.
- `key_hash` is 32 bytes: HMAC-SHA-256 of the bucket and the client key under
  a server key held outside the database and used for nothing else. The
  client key is the client address from the trusted proxy list, with an IPv6
  /64 counted as one address, or a signed-in session. No address, session id,
  identifier or email address is ever stored in clear.
- A trigger sets `expires_at` to `window_start` plus 24 hours, whatever the
  caller supplies.
- Row-level security is enabled and forced. `app_api` may select and insert,
  and update `count` only, so it can upsert a counter. It cannot delete. A
  platform job with no tenant set removes expired rows as `app_worker`, in
  batches of at most 10,000, as described under "Deleting expired rows".
- `key_hash` is classified as personal, a pseudonymous client identifier, and
  the other columns as internal. Every column has a fixed retention of 1 day
  from `window_start`, and no window may be longer than 12 hours.
- The catalogue test knows it by one named entry, `app.request_limit`, with
  the reason "hashed client keys and counters for rate limits; holds no tenant
  data". Beside that entry and the delete rule below, no exception is added.
- It is not an exception to rule 2. Rule 2 covers tenant-owned tables, and a
  counter belongs to a client, not a tenant, and holds nothing a tenant
  entered. Nothing else may be stored in it: no tenant id, no value in clear,
  no other kind of row. Another use needs a new ADR.
- Neither a counter nor a refusal writes an audit event.

### Deleting expired rows

Decided: both purges are plain `DELETE` statements run by `app_worker` under
row-level security, not definer functions. They delete only rows the
database itself marked expired, so a policy can bound them, and no new owner
role or approved function is needed.

- `app_worker` holds `DELETE` on both tables and `SELECT` only on the columns
  its `DELETE` reads: `tenant_id`, `id` and `expires_at` on
  `app.idempotency_key`, and the primary key and `expires_at` on
  `app.request_limit`. It holds no `INSERT` or `UPDATE` on either.
- On `app.idempotency_key` the only permissive `DELETE` policy is
  `TO app_worker USING (tenant_id = app.current_tenant_id() AND expires_at < now())`.
  On `app.request_limit` it is `TO app_worker USING (expires_at < now())`.
  Each has a `SELECT` policy `TO app_worker` with the same expression, since
  a `DELETE` with a `WHERE` clause reads the rows it deletes. So even the
  purge cannot remove a key or counter still in force.
- Each table has a restrictive policy,
  `FOR DELETE TO app_api, app_queue, app_auth USING (false)`, and none of
  those roles has a `DELETE` grant. In particular `app_api` cannot delete
  from `app.idempotency_key`, so no handler can clear a member's keys and
  make a duplicate create possible again, and it cannot reset a rate-limit
  counter.
- No policy on `app.request_limit` is `TO PUBLIC`: each names its role.
- No role's `INSERT` or `UPDATE` grant on either table covers `expires_at`,
  or `created_at` on `app.idempotency_key`, and the triggers set them
  whatever is supplied, so no caller can make a row expire early.
- The catalogue test checks all of this by name: `app_api`, `app_queue` and
  `app_auth` hold no `DELETE` on either table and fall under its restrictive
  `DELETE` policy; `app_worker` holds no `INSERT` or `UPDATE` on either; the
  only permissive `DELETE` policy on each is `app_worker`'s, with
  `expires_at < now()` as a top-level `AND` term, beside the tenant term on
  `app.idempotency_key`; and no `INSERT` or `UPDATE` grant covers
  `expires_at`.

## Consequences

- Rule 2: `app.idempotency_key` has `tenant_id`, forced row-level security
  and a policy for every command, with tests that deny another tenant's rows
  to every role with a grant. Cross-member tests prove that the same key from
  a second member is a separate row, never a replay.
- Rule 3: `(tenant_id, membership_id)` references `app.membership` with a
  composite foreign key. Checks hold `state` to its two values, tie `status`
  and `created_id` to `state`, keep `status` within `200` to `299`, keep
  `request_hash` at 32 bytes and keep `route_id` to its format. A trigger
  allows only `in_progress` to `completed`, and `app_api` can update no other
  column.
- Rule 4: writing a key is not an audited state change, but the create it
  guards is, and that audit event commits with the resource. A replay writes
  no second event.
- Rule 5: every column of both tables is classified with a fixed retention,
  `request_hash` and `key_hash` as personal.
- Rule 6: tenant and membership come from the session, the key from its
  header, and no request schema names any of them.
- Every new contracts entry point that builds on this ADR imports the zod
  switch in `packages/domain/src/jitless/` first, as the existing entry points
  do, so the browser apps' Content Security Policy holds.
- Offline sync (its ADR is due in 2027) and `connect`'s data loads will reuse
  the header and the store with the same scope: per tenant, member and route.
  A longer expiry for an offline queue would be that ADR's decision, not a
  quiet change to this one.
- `app.tenant_ids()` returns active tenants only, so a suspended tenant's keys
  outlive their retention until it is reactivated. It has no traffic, and the
  rows hold no values. The audit purge has the same property.
- Build order: the contracts (S11-14), the two tables (S11-31), rate limits
  (S11-36), then the middleware and purge job (S11-80).
- Each create writes one more row, in the same transaction.
- [ADR 0029](0029-tenant-by-tenant-data-migrations.md) (tenant-by-tenant
  data migrations, proposed with this ADR) never lets a data step reach
  either table.

## Dependency check

No dependency is added. SHA-256, HMAC-SHA-256 and uuid generation come from
Node.js's `crypto` module and the Web Crypto API.
