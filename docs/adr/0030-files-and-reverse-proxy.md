# ADR 0030: Files after upload, and the reverse proxy

- **Status:** accepted
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

Accepted by Aaron Gardner on 28 October 2026, with nginx (official, Alpine) as the reverse proxy.

## Context

[ADR 0047](0047-file-uploads.md) decided how files arrive: through the API,
scanned by clamd during the request, stored only when clean at
`clean/<tenant id>/<file id>`, recorded in `app.file`, linked through module
join tables, and downloaded only through the API. It left five questions to
this ADR:

- the reverse proxy: TLS, compression, request logs, rate limits and the
  client address;
- per-user and per-address limits on uploads;
- rescans after signature updates;
- retention and erasure of file content;
- whether larger files go straight to storage with a worker scan.

Until they are answered there are no upload limits, no proxy, and removed
files stay in storage. That is acceptable on synthetic data only.

[ADR 0022](0022-serving-the-web-apps.md) left TLS, compression, request logs
and rate limits to the proxy chosen here. [ADR 0005](0005-dev-topology.md)
planned a `POST`-only storage route through that proxy, which ADR 0047 made
unused.

Constraints:

- [Architecture rules](../ARCHITECTURE.md) 1 to 6 and 9.
- Request logs hold no client address
  ([ADR 0010](0010-authentication-security-rules.md)) and no personal data.
  Auth routes carry tokens in query strings and paths
  ([ADR 0004](0004-api-contract.md)).
- The API believes forwarded headers only from the addresses in
  `TPS_API_TRUST_PROXY`, and counts every limit against the address Fastify
  derives from them, reading `X-Forwarded-For` from the right.
- [ADR 0027](0027-erasure-across-modules-and-audit.md) (proposed) erases a
  person in one worker transaction, keeps an erasure ledger, and re-applies
  it after a restore. Backups are kept under object lock for 35 days,
  12 months and 7 years; ADR 0011 (being drafted) records them.
- Platform code never reads a module's tables
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)).
- The proxy is a separate container, so
  [ADR 0002](0002-licence-and-dependency-policy.md)'s service rule applies.

## Options considered

The reverse proxy:

1. **nginx.** Rate and connection limits, gzip, HSTS, body limits and
   buffering are built in, and its log format names each field, so the
   query string and client address can be left out. Smallest image and
   memory of the four, and the best known to operators. Automatic
   certificates need its ACME module, which the official image ships but
   which is at version 0.4. Its error log writes the client address and
   the full request line.
2. **Caddy.** Automatic certificates by default, structured logs with
   filters. Rate limiting is not built in: it needs a plugin and a custom
   build, so an image we compile and patch ourselves.
3. **Traefik.** Certificates, rate limits and compression built in. Larger,
   with discovery features we would turn off, and its access log's request
   path includes the query string.
4. **HAProxy.** The strongest limits (stick tables). TLS certificates by
   hand, a configuration language few operators know, and compression
   limited to what it buffers.
5. **No proxy: give the web servers TLS and limits.** No new image, but we
   would own TLS, limits and certificate renewal in `scripts/web-server.ts`,
   which ADR 0022 kept small on purpose.

Larger files:

6. **Keep scanning in the request**, with ADR 0047's 10 MiB ceiling.
7. **Add a second path for larger files:** browser to storage under a POST
   policy, a quarantine prefix, a worker scan and promotion, a storage route
   at the edge and a pending state the browser polls. ADR 0047 set this
   aside for MVP1 as too much to build and review.

Rescans:

8. **None.** A clean verdict stays clean.
9. **Scheduled rescans by a worker** of every stored file, or of recent ones.
   Reads the bucket daily for files nobody opens.
10. **Rescan at download** when the signatures have changed since the file's
    last scan.

## Decision

Options 1, 6 and 10.

### The reverse proxy

nginx, from the official image, run as a non-root user on ports above 1024,
with no capabilities and a read-only file system, in front of the console,
portal and API in the self-hosted stack.

Routing:

- It answers only the configured console and portal host names, or the one
  host of a single-host install. A request for any other host is closed
  without an answer, so the forwarded host the API believes is always one
  the operator named.
- `/api/` on each host goes straight to the API. Everything else goes to
  that app's web server, which never sees an API request. The web servers'
  own `/api/` forwarding (ADR 0022) stays for development and tests, and is
  off behind the proxy.
- `/health`, `/health/ready` and `/openapi.json` are not under `/api/`, so
  they never pass the proxy. Probes reach the API on the internal network,
  and the document that describes every route is not offered to the
  internet.
- A single-host install ([ADR 0010](0010-authentication-security-rules.md))
  serves the console under `TPS_CONSOLE_PATH_PREFIX`, `/console` say, and
  the API tells the apps apart by that prefix. There, every rule below
  written for `/api/` applies in the same way to `/<prefix>/api/`: it goes to
  the API with its path unchanged, prefix included, under the same body
  limits, the same rate limits (one count for both apps' API paths) and the
  same log redaction, so `/<prefix>/api/auth/` is logged alone. A console
  upload's session check goes to `/<prefix>/api/auth/session`, so the
  console's cookie is the one checked; a portal upload's goes to
  `/api/auth/session`. Everything else under `/<prefix>/` goes to the
  console's web server, and the rest of the host to the portal's.
- **Nothing routes to storage.** Files reach storage only through the API,
  so ADR 0005's `POST`-only storage route is not built (this amends ADR
  0005). The bucket has no edge at all.

The client address:

- The proxy sets `X-Forwarded-For` to the address that connected to it,
  replacing whatever the client sent, sets `X-Forwarded-Host` to the host
  name it matched and `X-Forwarded-Proto` itself, and drops `Forwarded` and
  `X-Real-IP`.
- The API's trusted proxy list holds the proxy's address alone. An operator
  who puts a load balancer in front of the proxy names it in the proxy's own
  trusted list (off by default), never by widening the API's.

Paths and bodies:

- Before matching, the proxy refuses with 400 any path holding an encoded
  slash, backslash, dot or NUL (`%2F`, `%5C`, `%2E`, `%00`, in either case),
  a `.` or `..` segment, or an empty segment (`//`). What it matches is then
  the path the API routes, byte for byte. Matching is case-sensitive, like
  the API's; a request that slips past a rule meets the smaller body limit
  and the API's own 404.
- Bodies: at most 10 MiB for `POST` to a path under `/api/` that ends in
  `/files`, ADR 0047's ceiling, which no tenant can raise. At most 1 MiB for
  any other API request, above the API's largest JSON limit. None to the web
  servers. A contract check makes every raw upload route's path end in
  `/files`. The API keeps its own limit on each route; the proxy's is a
  first layer.
- The session comes before an upload body. For an upload, the proxy first
  sends an `auth_request` to `GET /api/auth/session` (on a single host,
  `/<prefix>/api/auth/session` for a console upload) with the request's
  cookies and no body. A 401 or 403 goes back to the client as it is, and
  any other failure refuses the upload too, before the proxy reads a byte of
  the body. The API then checks the session and permission again before it
  reads the body itself (ADR 0047). An anonymous client cannot make the
  proxy or the API hold a file.
- The proxy streams request bodies to the API as they arrive, and keeps
  responses in memory buffers, never on disk (`proxy_request_buffering off`,
  `proxy_max_temp_file_size 0`). So it has no buffer area for clients to
  fill. Its temporary paths are a 16 MiB tmpfs that nothing should write to;
  if it ever filled, nginx would answer 500.
- At most 2 uploads at once from one client address. The API reads a whole
  body, at most 10 MiB in memory, before it takes one of ADR 0047's 4 scan
  slots, so a slow upload holds an API connection but never a scan slot.
  Each API process reads at most 16 upload bodies at once (160 MiB), and
  answers 503 with `Retry-After` beyond that, before reading the body.
- Deadlines: nginx can time a body out only between reads, so the API's
  120-second limit on receiving a whole request (ADR 0047) is the overall
  upload deadline; at that point it answers 408 and closes. The proxy allows
  10 seconds for headers, 30 seconds between reads of a body, and
  150 seconds for the API's answer, above that deadline plus the 25-second
  scan.

Rate limits, a first layer only. The API's own counters per account and per
address (ADR 0010, and the upload limits below) stay the authority, and the
API groups an IPv6 /64 as one address where the proxy cannot:

| What | Keyed by | Limit |
| --- | --- | --- |
| Requests under `/api/` | Client address | 20 a second, bursts of 100 |
| `POST` to `/api/…/files` | Client address | 30 a minute, bursts of 10 |
| `POST` to `/api/…/files` | Client address | 2 at once |
| Connections | Client address | 64 at once |

A refused request gets 429 with `Retry-After`. The numbers are a starting
point, set in one file the stack's tests read.

TLS and HSTS:

- TLS 1.2 and 1.3 only, with Mozilla's "intermediate" settings, and HTTP/2.
  Port 80 only redirects to HTTPS.
- Certificates are the operator's files, mounted as secrets. Automatic
  certificates through the official image's ACME module are not on by
  default: the module is young, and it needs the proxy to reach a
  certificate authority, the one way out of the stack the egress rules
  would otherwise deny. The self-hosting guide gives both ways.
- With a real certificate, every HTTPS response carries
  `Strict-Transport-Security: max-age=63072000; includeSubDomains`. No
  preload, which is the operator's choice. `pnpm stack` uses a certificate
  it makes for its own hosts and sends no HSTS, so a developer's browser
  never pins a `.localhost` host.

Headers, caching and compression:

- The proxy adds HSTS and nothing else. It never adds, removes or rewrites
  `Content-Security-Policy` or any other header the web servers and API
  set, and it caches nothing, so `index.html` keeps a fresh nonce on every
  response (ADR 0022).
- gzip for the web servers' text responses only. API responses are not
  compressed, because they can hold secrets beside input an attacker
  chooses, and files are already compressed formats.

Logs:

- The access log is JSON lines: time, host, method, path without its query
  string, status, bytes in and out, and durations. No client address, query
  string, body or header. A path under `/api/auth/` is logged as
  `/api/auth/` alone, since some carry tokens.
- The error log is set to `crit`, because nginx writes the client address
  and the full request line into request errors. Upstream failures, bodies
  over the limit and rate-limit refusals show in the access log by status.

The managed service maps the same rules onto Google Cloud's external
Application Load Balancer and Cloud Armor, configured only under
`infra/terraform/`, with no change to code:

- Google-managed certificates, an SSL policy of TLS 1.2 or later, and HSTS
  as a custom response header.
- The URL map has host rules for the configured console and portal hosts
  only. Its default answers 404 and reaches no backend. Under each host,
  `/api/` goes to the API and the rest to that host's web app, with no route
  to Cloud Storage. Health checks reach the backends directly.
- The load balancer passes a client's `X-Forwarded-Host` through untouched,
  so every route rule removes any `X-Forwarded-Host`, `Forwarded` and
  `X-Real-IP` the client sent (`requestHeadersToRemove`) and sets
  `X-Forwarded-Host` to the host its rule matched. As behind nginx, the
  forwarded host the API believes is one the operator named.
- Cloud Armor rate-based rules per client address, with the numbers above.
  Cloud Armor cannot count uploads at once per address; the API's limit of
  16 upload bodies per process, its 120-second deadline and its upload
  counters bound that case.
- The API's backend service timeout is 150 seconds, like the proxy's.
- The load balancer appends the client's address and its own to
  `X-Forwarded-For` rather than replacing the header. The API's trusted list
  holds Google's front-end ranges and the balancer's address; reading from
  the right, Fastify still ignores anything the client put to the left.
- Its request log records the full URL with the query string, so it is
  off, and Cloud Armor's refusals are watched through metrics.
- It has no body limit. The API's limit is the control, as it is
  everywhere.

Tests, in S11-41 for the stack and beside the load balancer under
`infra/terraform/` for the managed service:

- A portal-host request with a spoofed `X-Forwarded-Host`, `Forwarded` or
  `X-Real-IP` naming the console host still resolves as the portal, and the
  reverse. A request for a host nobody named gets no answer from the proxy
  and 404 from the load balancer.
- A spoofed `X-Forwarded-For` does not change the address that is counted.
- Each path form the proxy refuses (encoded separators and dots in either
  case, `.` and `..` segments, `//`) gets 400, and none reaches the API.
- An upload with no session, or an expired one, gets 401 while the client
  has sent headers only; the proxy reads no body.
- On a single-host stack, a console upload with only a portal session gets
  401 before its body is read, and one with a console session passes. A
  path under `/<prefix>/api/auth/` is logged as that prefix alone, and an
  upload over 10 MiB, or any other request over 1 MiB, under
  `/<prefix>/api/` is refused as it is under `/api/`.
- A third upload at once from one address gets 429. A 17th upload body at
  once in one API process gets 503.
- An upload that trickles one byte at a time is cut off at the API's
  120-second deadline.
- A slow 10 MiB upload and a slow-reading 10 MiB download write nothing to
  the proxy's temporary area.
- The proxy leaves every header the API and web servers set as it was, and
  `index.html` carries a different nonce on each response.

### Upload limits

The API counts uploads per membership and per client address in
`app.request_limit` ([ADR 0028](0028-idempotency-keys.md)), so every API
instance counts together, beside ADR 0047's checks and the proxy's first
layer:

| Counted against | Files | Bytes |
| --- | --- | --- |
| The uploading membership | 100 an hour | 250 MiB per 12 hours |
| The client address (IPv6 by /64) | 300 an hour | 1 GiB per 12 hours |

- This amends ADR 0028, which allows no other use of `app.request_limit`
  without a new ADR, in three ways and no more:
  - four more buckets: `upload_files_membership`, `upload_bytes_membership`,
    `upload_files_address` and `upload_bytes_address`;
  - in the two membership buckets the client key is the membership id from
    the session, stored, like every client key, only as the HMAC-SHA-256
    `key_hash` under the same server key. A membership, not a session, so
    signing in again does not reset the count;
  - in the two byte buckets `count` holds bytes, not requests. `count` is
    `bigint`, never negative, in every bucket.
- Everything else in ADR 0028 holds. Windows are fixed and none is longer
  than 12 hours, and `expires_at` stays `window_start` plus 24 hours, so the
  purge never removes a window still in force. The table holds no tenant id
  and no value in clear.
- The address limits are higher because one office's applicants often share
  an address.
- An upload is charged after the session and permission checks and before
  the body is read, by the `Content-Length` it declares. Upload routes
  require that header (411 without it), and the API stops reading at the
  declared length.
- An upload refused later, for its type or a virus, still counts. One
  refused by a limit does not. A replay under the same idempotency key
  ([ADR 0028](0028-idempotency-keys.md)) returns the first answer and is
  not charged again.
- At a limit the answer is 429 with `Retry-After` and a message saying when
  to try again.
- There is no per-tenant counter. ADR 0047's 100 MiB per application bounds
  what each record stores.

### Rescans

A file is scanned again when it is downloaded, if clamd's signatures have
changed since its last scan. A match at a rescan withholds the file; it
never destroys it.

- `app.file` records the signature version of each scan, from clamd's
  `VERSION` reply. Before a download the API asks clamd for its version
  (kept for a minute). If it is newer, the API reads the object, scans it
  again, and only then sends it.
- Every download also checks the bytes against the row's SHA-256, so an
  object changed in storage is never served. Integrity and evidence are what
  the hash is for. It never deduplicates: each upload stores its own object,
  within a tenant as across tenants.
- A clean rescan records the new version and time, and the file is sent.
- A signature match withholds the file. The API locks the file's row
  (`SELECT ... FOR UPDATE`) and checks it is still clean, not erased, and
  has the storage key and hash it read the bytes under, writes the bytes
  it holds to `withheld/<tenant id>/<file id>` with the scanner's key, then
  moves the row from `clean` to `withheld` with that storage key, the
  verdict and the version, keeping its hash, and commits, holding the lock
  throughout (see "Retention"). It writes `platform.file.withheld` with the
  verdict, and the caller gets the same answer as for a missing file. The
  object under `clean/` no longer has a clean row, so the sweep removes it.
- A withheld file is never served: a download needs a clean row, and the
  downloads key cannot read `withheld/`. Only the scanner's key can.
- A daily worker job, the withheld recheck, asks clamd for its version and
  rescans each withheld file last scanned under an older one, one at a
  time. It reads the object with the scanner's key and checks it against
  the hash. If it is clean, the job locks the row as a withhold does, checks
  it is still withheld, not erased, and has the storage key and hash it
  read, writes the object back under `clean/`, returns the
  row to `clean` with the new version, writes `platform.file.restored` and
  commits; the `withheld/` copy is then swept. A match
  records the new version and the file stays withheld. An error changes
  nothing and waits for the next run.
- A withheld file's content is deleted only by:
  - a staff member's "Delete withheld file" action, under a permission each
    module names for its records in its contracts. It moves the row to
    `infected`, clears its hash and storage key, and writes
    `platform.file.deleted` with the acting membership. The link stays, so
    the record still shows the question had a file;
  - the record's own retention, or removing the file from a draft, which
    release it like any file;
  - erasure under ADR 0027.

  The sweep then deletes the object.
- A scanner error, a timeout or no free scan slot at download gets 503 with
  `Retry-After`. The row is unchanged and nothing is sent.
- This amends ADR 0047's rule that a final state never changes. A clean row
  may record later clean scans and may move to `withheld`. A withheld row
  may record later scans, return to `clean`, or move to `infected` by a
  staff deletion. Nothing else changes. An erased row (its erasure time set)
  is terminal: the trigger refuses every later change to it but the single
  setting of its release time, so no rescan, withhold, restore or staff
  deletion can give it back a storage key, a hash, a scan or another state,
  and the sweep can still delete a released erased row. The migration that
  adds the state
  amends migration 0008's `file_scan_columns` check so that a withheld row
  has its scan time, hash and storage key, and its
  `file_storage_key_own_object` check so that the key is
  `clean/<tenant id>/<file id>` for a clean row and
  `withheld/<tenant id>/<file id>` for a withheld one. The trigger that
  records scans allows only these changes.
- Rescans at download share ADR 0047's limit of 4 scans at once per API
  process.

What people see:

- The applicant sees that the file is held back because a later virus
  check flagged it, and can attach another while the application is a
  draft.
- Staff see that the file is held back after a later virus check and
  cannot be downloaded, that it is checked again with each signature update
  and comes back by itself if it passes, and that they can ask the
  applicant for another copy or delete it.
- A refused or withheld file never rejects an application; a person decides
  ([architecture rule 9](../ARCHITECTURE.md)).

Why at download: a file reaches someone's device only by a download, so a
scan then catches what new signatures find exactly when it matters, with no
reading of the whole bucket. The cost: downloads stop while clamd is down,
as uploads already do, and the first download after each signature update
waits a few seconds. Why withhold: signature updates bring false positives,
and the hash and object are a submitted application's evidence. A false
positive then costs a delay, not the evidence, and only a person, the
record's retention or erasure removes the content.

### Larger files

Scanning stays in the request, with the 10 MiB ceiling. No direct upload to
storage, POST policy, quarantine prefix, uploads key or worker scan is
built. A module that needs larger uploads (video as visit evidence, say)
brings a new ADR, starting from ADR 0005's plan.

Presigned downloads wait for that ADR too. Before any is issued, a test must
show that the storage in use, SeaweedFS and Cloud Storage alike, sends
`X-Content-Type-Options: nosniff` and the forced disposition and type.

### One file, one link

- A file is linked to exactly one record, in the transaction that uploaded
  it, and never linked again. A module that needs the same document
  elsewhere copies it into a new file. So a file takes the classification
  of its one record and question, with nothing to reconcile.
- A file answer is personal at the least: the form engine refuses a public
  or internal class on a file question, because ADR 0047 classifies every
  file name and its content as personal.
- `app.file` records when the file was linked and when the link was
  released. Each is set once, by platform functions that every join table's
  triggers call, and a second link is refused by the database. Platform
  code then knows which files are in use without reading module tables.
- Notes, messages and tags (being drafted) follow the same pattern: a
  platform table, module join tables with composite foreign keys
  `ON DELETE RESTRICT`, and no polymorphic owner column.

### Retention

A daily worker job ([ADR 0009](0009-background-jobs.md)), the file sweep,
removes what no record needs, through approved definer functions
([ADR 0003](0003-query-builder-and-migrations.md)) that only `app_worker`
can run:

- **Released files:** the object, then the row. Removing a file from a
  draft releases it; so does a module's retention purge of the record. A
  linked file lives as long as its record, under that record's rule in the
  classification map.
- **Refused rows** (`infected` and `error`) that no record links: deleted
  12 months after the scan, ADR 0047's audit floor. They have no object. A
  withheld file a staff member deleted stays linked, and its row lives as
  long as its record.
- **Objects with no row:** any object more than an hour old under
  `clean/<tenant id>/` or `withheld/<tenant id>/` whose row does not point
  at it (no row, a row in another state, or an erased row, which has no
  storage key) is deleted. This catches a failed commit
  (ADR 0047), the copy left behind when a file is withheld or restored, a
  staff deletion, and an erased file whose deletion failed. The hour keeps
  the sweep away from an upload still committing, whose key is new.
- **One file at a time, under its row lock.** A withheld or restored copy
  reuses the file's fixed key, and storage has no conditional delete, so
  the sweep's age and state checks must not go stale before it deletes. For
  each object it would remove, the sweep calls a definer function that locks
  the file's row, if it has one (`SELECT ... FOR UPDATE`), and returns its
  state. Holding that lock, the worker re-checks the state, reads the
  object's age with a `HEAD` rather than from the listing, deletes it only
  if both still say so, and then commits. A withhold at download and a
  restore by the recheck take the same lock before they write their copy
  and keep it until the row commits, and every other change to the row
  locks it as any update does. So a copy is either written after the
  sweep's delete, under a row the sweep can no longer act on, or seen by
  the sweep as belonging to its row. The sweep never removes the object a
  row points at.
- **One tenant job per tenant.** As [ADR 0009](0009-background-jobs.md)
  requires for work across tenants, a daily platform job lists tenants
  through `app.tenant_ids()` and, from inside each tenant's context, sends
  that tenant one sweep job and one withheld recheck job on a single tenant
  queue. The queue uses pg-boss's `singleton` policy with the tenant id as
  the singleton key, so one tenant's sweep and recheck never overlap and
  one tenant's job never suppresses another's. Each job lists only its
  tenant's `clean/<tenant id>/` and `withheld/<tenant id>/` prefixes and
  calls the definer functions in its tenant's context; no handler touches
  file rows outside one.
- Each run writes one audit event per tenant with counts, never names.

Tests, in S11-61 for the definer functions and S11-74 for the API and
worker: a restore and a sweep run at once, in both orders of taking the
lock, and the restored `clean/` object survives while the stale
`withheld/` copy goes; the same for a withhold at download racing the
sweep, where the `withheld/` copy survives; and a file that goes clean,
withheld, clean and withheld again keeps the object its row points at
throughout.

Erasure races, in the same tasks, each run in both orders of taking the
lock:

- an erasure racing a withhold at download that read the bytes first: the
  row ends erased, with no storage key, hash or `withheld` state, and no
  `withheld/` object survives the next sweep;
- an erasure racing a restore by the withheld recheck that read the object
  first: the row ends erased, and no `clean/` object survives the next
  sweep;
- on an erased row, every update the trigger allows elsewhere (a recorded
  rescan, a withhold, a restore, a staff deletion, setting a storage key
  or hash): refused by the database, while setting its release time once
  is accepted;
- the sweep and recheck for one tenant are never active at once, and a
  running sweep for one tenant does not stop another tenant's from
  starting.

Keys and bucket:

- The worker holds a fourth key pair, removal: list and delete under
  `clean/` and `withheld/` only. The API never deletes an object.
- The scanner's key gains read and write under `withheld/`. The worker
  holds it too, for the withheld recheck, and its egress rules
  ([ADR 0010](0010-authentication-security-rules.md)) let it reach clamd.
  The downloads key still reads `clean/` only. These amend ADR 0047's list
  of keys.
- The files bucket has no versioning, no provider soft delete or retention
  hold, and no object lock, so a delete removes the only copy. The sweep
  checks the bucket's versioning before it runs and refuses if it is on or
  suspended. Object lock belongs to backups (ADR 0011, being drafted).

### Erasure

Under ADR 0027, each module's erasure contribution erases the files on its
records whose subject is the erased party, reached through its subject path
(for grants, the applicant's applications):

- Every file answer is erased, whatever its question's class or its
  state, withheld included. The name is replaced by a fixed placeholder,
  the hash and storage key are cleared, and the erasure time is set. Type,
  size and times stay. The scan columns check accepts a row with no hash or
  key once its erasure time is set.
- The link stays, so the record still shows that the question had a file,
  and no count or figure changes.
- The change goes through an approved definer function executable by
  `app_worker` only, which refuses unless ADR 0027's guard holds (a job
  request naming the party, or a ledger row in restore mode).
- The erasure function updates each row under its lock like any other
  change, and from then on the row is terminal (see "Rescans"), so a
  withhold or restore that read the bytes before the erasure finds the row
  erased when it takes the lock, and writes nothing.
- Once the erasure commits, the worker deletes the objects. The sweep is the
  backstop. A download needs a clean row with a storage key, so an erased
  file is never served, even before its object is gone.
- Files on records about someone else, such as an organisation's accounts
  uploaded by its contact, stay with that record. Erasure never reads file
  content, so a person named only inside a file is out of its reach.

Backups and restores:

- If ADR 0011 copies file objects, they sit in its locked tiers, so erased
  file content can survive in a backup for up to 7 years, the yearly tier,
  unread. ADR 0027's privacy wording already covers this. ADR 0011 may keep
  file objects for less.
- After a restore, ADR 0027's ledger re-apply runs each module's file
  erasure again. The restore runbook then runs the sweep before restore
  mode ends, so objects brought back for erased or released files are gone
  before the API takes traffic.

### Content Security Policy

`connect-src` stays `'self'`: uploads go to the API on the app's own origin.
[ADR 0006](0006-design-system.md)'s policy is unchanged. Embeds and their
origins are for ADR 0035 (being drafted).

### Blind review

ADR 0047 gives no reviewer a file in MVP1. When reviewers gain file access,
a file's name, size, type, upload time and count are part of the audience
projection like its content, and a reviewer who may not see a file answer
gets no list entry and the same 404 as for a missing file, so never learns
it exists.

## Consequences

- This amends ADR 0047 (rescans change a clean row and add the withheld
  state; a `withheld/` prefix for the scanner's key; the scanner and removal
  keys for the worker), ADR 0028 (four upload buckets in
  `app.request_limit`, keyed in part by membership, two of them counting
  bytes) and ADR 0005 (no storage route). Presigned downloads, already
  unused, wait for a new ADR. ADR 0022's open point is answered without
  changing its server.
- Upload intents, a worker scan, quarantine promotion, a POST policy, the
  storage route and a browser upload to storage are not needed. Uploads,
  scanning and downloads stay as ADR 0047 built them.
- The work this creates:
  - `app.file` gains the `withheld` state, the scan's signature version,
    link, release and erasure times, the amended `file_scan_columns` and
    storage key checks, the state changes above, and the sweep, recheck,
    staff deletion and erasure functions;
  - `app.request_limit` gains the four upload buckets, with `count` as
    `bigint`;
  - the API gains rescans that withhold under the file's row lock, the
    staff deletion, the hash check on download, the upload counters and its
    limit on upload bodies read at once;
  - the worker gains the sweep, the withheld recheck and object deletion,
    as one job per tenant on a tenant queue with a tenant singleton key,
    each under the file's row lock, with the scanner
    and removal keys and a route to clamd;
  - contracts gain the `/files` path check for raw upload routes, and the
    form engine the floor on a file question's class;
  - the stack gains the proxy and its session check before upload bodies,
    with the same rules under a single host's console prefix;
    the managed service its load balancer rules, with header removal and
    host rules. Each comes with the tests listed under the proxy.
- While clamd is down nobody can upload or download a file whose last scan
  is older than the signatures. Nothing is served unchecked.
- The proxy's limits count each IPv6 address on its own. Rotating addresses
  inside a /64 passes the proxy and meets the API's limits.
- A signed-in client with many addresses can still hold the API's 16 upload
  slots per process for 2 minutes at a time. Each attempt is charged to its
  membership's byte counter before the body is read, so one membership can
  do it about 25 times in 12 hours, and every attempt names it.
- A withheld file stays in storage, unread by anyone, until a signature
  update clears it or a person, its record's retention or erasure removes
  it.
- Rule 1: storage calls are put, get, head, delete, list by prefix and get
  versioning. CI tests them against SeaweedFS, and the managed service runs
  the same tests against Cloud Storage. Google specifics live only in
  `infra/terraform/`.
- Rule 2: the new columns are under `app.file`'s row-level security. Every
  join table has `tenant_id`, row-level security and a cross-tenant denial
  test. Object keys are made by the server, and storage has no edge, so no
  key can be fetched without the API.
- Rule 3: states and their changes are checks and triggers; links are
  composite foreign keys; no polymorphic owner or text-typed key.
- Rule 4: upload, refusal at upload, withholding at rescan, restoring,
  staff deletion, staff download, each sweep run and each erasure are
  audited, with ids, codes and counts only. Staff
  downloads stay sensitive reads.
- Rule 5: the new columns are internal, file names and content personal,
  and each has a retention rule.
- Rule 6: the actor comes from the session; limits are charged to the
  session's membership and the derived address; the server re-checks size
  and type and never trusts declared values.
- Rule 9: a refusal at upload or a file withheld at rescan never decides an
  application, and withheld content is deleted only by a person's action,
  the record's retention or erasure.
- The files contracts stay in `packages/domain/src/files/`, which imports
  the jitless switch first, as every contracts entry point does.

## Dependency check

| Image | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| nginx (official, Alpine) | 1.31.6 | BSD-2-Clause; ACME module Apache-2.0 | Image built 2026-09-22 | Maintained by F5 and the nginx team, with regular mainline releases. Pinned by digest under the 7-day rule in [ADR 0001](0001-monorepo-toolchain.md) when added, with Trivy and the SBOM covering its OS packages |
| Caddy (not chosen) | | Apache-2.0 | | Rate limits need a plugin build |
| Traefik (not chosen) | | MIT | | Larger; query string in its access log |
| HAProxy (not chosen) | | GPL-2.0-or-later, separate program | | Certificates by hand |

No npm package is added. The proxy is a separate container under ADR 0002's
service rule, like ClamAV and SeaweedFS.
