# ADR 0040: E-signature and document generation

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Several tools need documents made from their data and, for some, signed:

- `governance` and E10 need board packs: a PDF of selected applications
  for trustees. They are the first user of document generation.
- Post-award (wave 2, June 2027) needs grant agreements made from a
  template and signed by the grantee's signatories. `dca`, `people` and
  `volunteers` need contracts and agreements later.

[V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1) keeps agreements and
e-signature out of V1, so this ADR adds no V1 work. It settles the
provider interface (built in November and December 2026), the first
provider (Q1 2027), the callback route that reaches tenant data, and how
documents are generated, before the contracts, schema, board pack and
interface are built. We will never build our own e-signature engine
([ADR 0041](0041-money-and-the-finance-boundary.md), "What we will never
build"); we integrate with one.

What this builds on:

- **Files.** [ADR 0047](0047-file-uploads.md) and
  [ADR 0030](0030-files-and-reverse-proxy.md): one platform table,
  `app.file`, with a SHA-256, a scan state (`pending`, then `clean`,
  `infected` or `error`) and an object only once clean; module join tables
  with composite foreign keys; one file, one link; a 10 MiB ceiling; file
  names and content are personal; downloads only through the API, audited.
- **Public routes.** [ADR 0019](0019-tenant-addresses-public-pages-and-theming.md):
  a public route sets no tenant and reaches data only through
  [ADR 0003](0003-query-builder-and-migrations.md#approved-definer-functions)'s
  approved definer functions (`NOLOGIN` owner, pinned `search_path`, exact
  grants, a catalogue test entry).
  [ADR 0004](0004-api-contract.md): problem details, the audience
  projection, and raw bodies only on routes named for them.
- **Jobs.** [ADR 0009](0009-background-jobs.md): payloads hold ids only,
  errors are codes only, the worker sets the tenant from the payload, and
  jobs that act for a user go through a `job_request` row.
- **Outbound and secrets.** [ADR 0010](0010-authentication-security-rules.md):
  one dispatcher for outbound HTTP, which allows only public addresses
  over HTTPS with a 1 MB body; fixed destinations through clients pinned to
  one configured host and port; keys derived per purpose from the auth
  secret, and stored secrets encrypted with a key version.
- **People.** [ADR 0017](0017-bespoke-crm-party-core.md): signers are
  `party.person` rows; [ADR 0025](0025-party-matching-merge-and-search.md):
  merged people are followed to the survivor.
- **Sends, events and keys.** [ADR 0020](0020-release-emails-without-a-worker.md)
  and [ADR 0033](0033-consent-and-communications.md): email through an
  outbox, with a purpose. [ADR 0034](0034-event-outbox.md): events.
  [ADR 0028](0028-idempotency-keys.md): every create route takes an
  idempotency key.
- **Erasure.** [ADR 0027](0027-erasure-across-modules-and-audit.md):
  statutory retention and legal hold are left to a Q1 2027 ADR.
- **Embeds.** [ADR 0035](0035-embeds-and-custom-domains.md) governs any page
  of ours in another site's frame, and the reverse.
- Rule 10: templates are configuration, versioned with author and diff.

Facts about providers, libraries and law below rest on general knowledge
where marked (GK). The first provider adapter (Q1 2027) and the PDF library
pin re-check them against the release they pin.

## Options considered

The signing service:

1. **Build our own signing engine.** Rejected: on the never-build list. A
   signing service carries evidence, sealing and legal weight we should
   not own.
2. **DocuSeal, self-hosted.** AGPL-3.0, run as a separate service.
3. **Documenso, self-hosted.** AGPL-3.0, run as a separate service.
4. **A commercial provider (DocuSign, Adobe Acrobat Sign) as an adapter in
   our process.** Rejected for the core: provider-specific code and
   credentials for a paid service inside every deployment, and documents
   leaving the cell for a third party by default. Offered only as an
   out-of-process plugin under ADR 0044 (plugin API v1, being drafted).

Compared on what we need (all GK):

| Need                       | DocuSeal                                                                 | Documenso                                                              |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Licence                    | AGPL-3.0; some features only in a paid edition                           | AGPL-3.0; code in its `ee` directory under a commercial licence        |
| Maintenance                | Company-backed; frequent releases                                        | Company-backed; frequent releases                                      |
| Stack                      | Ruby on Rails; SQLite, PostgreSQL or MySQL                               | TypeScript on Node.js; PostgreSQL                                      |
| API                        | REST: templates and submissions, external ids                            | REST (v1 and v2), with API tokens per team                             |
| Webhook signing            | A secret header set per account; no signature over the body              | A secret sent in a header per team webhook; no signature over the body |
| Evidence                   | Audit log PDF: events, times, IP addresses, emails                       | Audit log and signing certificate: events, times, IP addresses, emails |
| Sealing                    | Signs the completed PDF with a certificate                               | Seals the completed PDF with a certificate the operator supplies       |
| One account per tenant     | One account per instance in the open source edition, as we understand it | Teams, each with its own tokens and webhooks                           |
| Signing page accessibility | Not yet audited by us                                                    | Not yet audited by us                                                  |
| Footprint                  | One container, light; can run on SQLite                                  | One container plus a PostgreSQL database                               |

How the service learns that a signer acted:

5. **Polling only.** No public route at all, but news arrives minutes or
   hours late, and the load grows with every open request.
6. **A callback whose address names the tenant.** Against ADR 0019: any
   caller could then aim requests at a tenant's data.
7. **A callback as a hint, plus polling as the backstop.** An opaque
   reference finds the tenant through an approved definer function; the
   body only says "go and look", and the worker reads the real status from
   the provider.

The PDF library, for board packs and agreements:

| Option                               | Licence                     | Maintenance (GK)                                            | Tagged PDF and PDF/UA (GK)             | Fonts                                                    | Footprint                                               | Runs without network                           |
| ------------------------------------ | --------------------------- | ----------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| 8. pdfkit                            | MIT                         | Active; several releases a year                             | Yes: structure tags, and a PDF/UA mode | Embeds and subsets TrueType and OpenType through fontkit | A JavaScript package, in process                        | Yes                                            |
| 9. pdf-lib                           | MIT                         | Last release, 1.17.1, in November 2021                      | No                                     | Embeds fonts, but has no text layout                     | Small                                                   | Yes                                            |
| 10. @react-pdf/renderer              | MIT                         | Active                                                      | No structure tags                      | Embeds fonts                                             | Medium, with a React renderer                           | Yes                                            |
| 11. Typst, as a separate binary      | Apache-2.0                  | Active; tagged PDF by default and PDF/UA-1 from 0.14 (2025) | Yes, automatic                         | Embeds fonts                                             | A Rust binary of tens of megabytes, run as a subprocess | Yes, if package downloads are turned off       |
| 12. HTML to PDF in headless Chromium | BSD-3-Clause and Apache-2.0 | Very active; frequent security releases                     | Yes                                    | System and web fonts                                     | Hundreds of megabytes; a browser sandbox in the worker  | Only if every request from the page is blocked |

pdf-lib and @react-pdf/renderer cannot make an accessible board pack.
Chromium brings a large, fast-moving attack surface into the worker, and
an HTML template can try to fetch from anywhere. Typst produces the best
tagged output with the least effort, but adds a binary, a subprocess and a
template language that is itself a program. pdfkit asks us to tag every
element ourselves, which one renderer does once for every block kind.

## Decision

Documenso as the first provider (option 3), callbacks as hints (option 7)
and pdfkit (option 8).

### The provider interface

One adapter interface in `packages/domain/src/documents/` (S12-12). An
adapter is the only code that knows a provider. It can:

- **create an envelope** from one clean PDF `app.file`, given as bytes the
  worker reads, with signers in signing order. Signers are given as
  `party.person` ids, never as emails: the worker resolves each person's
  name and email address through the party contract at send time, passes
  them to the adapter, and stores neither. The adapter sets our request id
  as the provider's external id and the provider's own emails off;
- **read back** the provider's copy of the original document;
- **read status**, for the envelope and each signer;
- **cancel** an envelope;
- **fetch the signed file** and **the evidence** (the provider's audit
  trail or completion certificate) once complete;
- **delete** the envelope's documents at the provider;
- **verify a callback** over its raw body and headers, and parse it into a
  provider reference and an event id.

Every adapter result is parsed by a strict schema. The provider reference
is opaque text, length-capped, that the platform stores and never parses.

### Statuses

A request's status is a closed enum. Only these moves are allowed, by
`canMoveTo()` in the contract and by a trigger in the database:

| From                                                   | To                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `draft`                                                | `sent`, `cancelled`, `failed`                                    |
| `sent`                                                 | `viewed`, `signed`, `declined`, `expired`, `cancelled`, `failed` |
| `viewed`                                               | `signed`, `declined`, `expired`, `cancelled`, `failed`           |
| `signed`, `declined`, `expired`, `cancelled`, `failed` | Nothing: final                                                   |

- `viewed` means at least one signer has opened it. `signed` means every
  signer has signed, and the signed file and evidence are stored and have
  passed the checks below; until then a completed envelope stays `sent` or
  `viewed`. `failed` carries an error code.
- Each signer has a status of its own: `waiting` (not yet their turn),
  `sent`, `viewed`, `signed` or `declined`.
- Only a person starts a request (`draft`) or asks to cancel it. The
  worker makes every move, from what it read from the provider, never from
  a callback body. A cancel is made at the provider first; if the provider
  shows the envelope already signed, the request becomes `signed`. A
  status the provider reports that the request cannot move to is refused:
  the request stays as it is, and the refusal is logged with a code and
  audited.
- To send again after a decline, expiry or failure, a person makes a new
  request.

### Tables

Built in S12-62, as platform tables under ADR 0003 with `tenant_id`,
row-level security and a cross-tenant denial test each:

- `app.signature_connection`: a tenant's account at a provider. The adapter
  key, the provider's account or team id, its API token stored encrypted
  with its key version as ADR 0010 stores SSO secrets, the SHA-256 of the
  callback reference (unique across all tenants), the callback key version
  and a status. One active connection per tenant and provider.
- `app.signature_request`: its connection, status, error code, provider
  reference (null until sent; unique per connection), the SHA-256 of the
  file sent, the template version it was generated from if any, its expiry,
  the membership that asked, and its times.
- `app.signature_signer`: the request, the `party.person`, the signing
  order (positive, unique per request) and the signer's status. No name or
  email address is stored anywhere in these tables.
- `app.signature_request_file`: the join table to `app.file`, one row per
  role (`sent`, `signed`, `evidence`), unique by request and role, with
  composite foreign keys `ON DELETE RESTRICT` to both sides and ADR 0030's
  link triggers. A deferred check holds that a request is `signed` exactly
  when it has a `signed` and an `evidence` file.
- `app.signature_callback`: callbacks received: the request, the event id,
  when it arrived and when it was dealt with. Unique by request and event
  id. Kept 30 days.
- `app.document_template_version`: below.

All foreign keys are composite with `tenant_id` and real (rule 3): signers
to `party.person`, files to `app.file`, and the asker to `app.membership`.
`app_api` writes only a `draft` request, its signers and its `sent` file;
status, provider reference, the signed file and evidence, and signer
statuses are written only by `app_worker`.

### Sending

1. A module's route (wave 2's agreements, say) calls the send service in a
   member's request. The sender comes from the session (rule 6), under the
   module's permission. The route is a create route and takes an
   idempotency key (ADR 0028).
2. The service checks that the file is clean, a PDF and within the 10 MiB
   ceiling, and re-checks each signer through the party contract: in this
   tenant, not erased, with an email address. It copies the file into a new
   `app.file` linked as `sent` (one file, one link), records its SHA-256,
   writes the `draft` request and its signers, audits it, and sends one
   ids-only job.
3. The worker re-checks the request is still `draft` and each signer is
   still valid (a merged signer is followed to the survivor through the
   party contract; an erased one fails the request with
   `signature.signer_unavailable`). It first looks up an envelope with our
   request id as external id, so a retried job never makes a second one,
   and otherwise creates it. It then reads back the provider's copy of the
   original: if its SHA-256 differs from the file sent, it cancels the
   envelope and fails the request with `signature.upload_mismatch`.
   Otherwise it records the provider reference and moves to `sent`.
4. Invitations go through our own email outbox (ADR 0020's pattern, purpose
   `transactional` under ADR 0033), in signing order: the refresh job sends
   the next signer's invitation when the provider shows it is their turn.
   The email job fetches the signing link from the provider when it sends.
   The link is a bearer secret: it is never stored, logged or audited.
5. Every request has an expiry, at most 90 days ahead, set at the provider
   too where it supports one.

### Signed file and evidence

When the provider reports an envelope complete, the refresh job:

1. Fetches the signed file and the evidence, each within the 10 MiB
   ceiling.
2. Reads back the provider's copy of the original again, and refuses unless
   its SHA-256 still equals the file sent. Where the evidence records the
   provider's document id or hashes of the original or signed file, each
   must match ours; the adapter says which its provider records.
3. Stores each through the files pipeline: an `app.file` row `pending`, the
   type check (a PDF, or the provider's evidence format if that is not a
   PDF), a clamd scan, and an object only on a clean verdict. Since the
   worker writes these rows, it takes the insert and verdict rights ADR
   0047 foresaw moving to `app_worker`.
4. Links both to the request (`signed`, `evidence`) and moves it to
   `signed`, in one transaction. The signed file's SHA-256 is in
   `app.file` and in the audit event, so any later change to the stored
   copy can be detected.
5. Deletes the envelope's documents at the provider, where its API can
   (GK).

If any check fails, the request moves to `failed` with
`signature.document_mismatch` (or the scan's code), nothing is linked as
signed, the audit event records the hashes it compared, and the envelope
stays at the provider for investigation. A person decides what happens
next (rule 9); nothing re-sends on its own.

Evidence holds signers' names, email addresses, IP addresses and browser
details: it is personal. The signed file is personal too, like every file.

### Callbacks

One public route, `POST /public/signature-callbacks/{reference}`, on the
API. It sets no tenant (ADR 0019) and is a raw-body route (ADR 0004), the
first under `/public/`; this amends ADR 0047's limit of raw bodies to
console and portal routes for this one route.

**The reference is per connection, not per request.** Self-hosted
providers set one webhook address per account or team, not one per
document (GK), so a per-request address cannot be relied on. Each
connection gets 32 random bytes, sent as base64url, that appear only in
the webhook address held at the provider; we store only their SHA-256. The
address carries no tenant slug or id.

**The reference is never logged.** It is a bearer value in the path, so
storing only its hash is worth nothing if a log keeps it in full:

- The proxy's access log records any path under
  `/api/public/signature-callbacks/` as that prefix alone, as ADR 0030 does
  for `/api/auth/`. The managed service's load balancer request log stays
  off, as ADR 0030 already decides.
- The API's request logger shows the route's pattern,
  `/api/public/signature-callbacks/:reference`, never the raw path, as ADR
  0004 has it do for tokens in auth paths.
- Traces name spans by that route pattern and carry no raw path or URL
  attribute for this route.
- A 413, 415, 429 or 503 answer, a rate-limit record, an error log line, an
  audit event and a job payload never hold the reference; the rate limit
  keys on its HMAC.
- S12-85's tests send a callback and check that the reference appears in
  no API log line or span; S11-41's proxy test checks the access log.

An operator command replaces a connection's reference and key version
together, for when one is exposed anyway, such as in the provider's own
logs.

**The callback secret is derived, never stored.** The API derives it from
the auth secret with HKDF-SHA-256, for the purpose "signature callback",
from the connection's key version, its tenant id and the reference's
SHA-256, as ADR 0010 derives a key per purpose. The database holds the key version only. The
provider's API token, which the provider issues, is the stored secret, and
is encrypted as ADR 0010 encrypts SSO secrets.

The handler, in order:

1. Refuses a body over 64 KiB with 413 before reading further, and any
   type other than JSON with 415. The proxy's 1 MiB limit is a first layer.
2. Counts the request against a per-reference limit in
   `app.request_limit`, keyed by the reference's HMAC as ADR 0028 keys
   every client, with 429 at the limit. This adds one bucket,
   `signature_callback_reference`, to ADR 0028's list, as ADR 0030 added
   its upload buckets.
3. Calls `app.resolve_signature_callback()` with the reference's SHA-256.
4. Verifies the provider's signature over the raw body with the derived
   secret, in constant time. Where the provider signs a timestamp with the
   body, one outside 5 minutes of our clock fails. Where the provider sends
   only a shared secret in a header (as both candidates do, GK), the
   handler compares HMACs of the two values, so lengths never leak. When
   step 3 found nothing, it verifies against a fixed dummy key, so an
   unknown reference costs the same work.
5. Only then parses the body with the adapter's strict schema, for the
   provider reference and the event id (the provider's own, or the SHA-256
   of the raw body where it has none). Status in the body is ignored.
6. Calls `app.record_signature_callback()`, which records the hint for
   the worker or reports it as already seen.
7. Answers 204 with no body, whatever happened in steps 3 to 6. A caller
   learns nothing about whether a reference, request or signature was
   good. Only a database outage before step 3 answers 503.

The worker picks hints up through a platform schedule every minute: it
calls `app.signature_callbacks_pending()` and sends one refresh job per
request from inside that request's tenant, as ADR 0009 does for work
across tenants. Each request has one refresh job at a time (a singleton
key with the tenant and request ids). The refresh job reads status from
the provider and acts on that alone.

A reconciliation schedule refreshes every open request at least every
6 hours, and once at its expiry, so a lost or refused callback only
delays news. At expiry, an envelope still open at the provider is
cancelled there and the request moves to `expired`.

These join ADR 0003's approved definer functions, each with its own
`NOLOGIN` owner ([ADR 0023](0023-function-owner-memberships.md)),
`search_path = pg_catalog, pg_temp`, every name qualified, `EXECUTE`
revoked from `PUBLIC` and granted to exactly its "Callable by" role, one
indexed lookup by hash, and a catalogue test entry:

| Function                                                                      | Callable by  | Returns                                                                                                                 | Its owner holds                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.resolve_signature_callback(reference_hash)`                              | `app_api`    | For an active connection of an active tenant: its tenant id and callback key version. Nothing otherwise, never an error | `SELECT` on `id` and `status` of `app.tenant`, and on `tenant_id`, `id`, `status`, `callback_reference_hash` and `callback_key_version` of `app.signature_connection`, each with a `SELECT` policy `TO` it that is `USING (true)`                                                          |
| `app.record_signature_callback(reference_hash, provider_reference, event_id)` | `app_api`    | One of the fixed codes `recorded`, `seen` and `not_found`; never a row                                                  | The `SELECT` above, plus `SELECT` on `tenant_id`, `id`, `connection_id`, `status` and `provider_reference` of `app.signature_request`; `INSERT` on the columns it writes of `app.signature_callback` and `app.audit_event`; a policy `TO` it on each, and no `UPDATE` or `DELETE` anywhere |
| `app.signature_callbacks_pending()`                                           | `app_worker` | Tenant ids and request ids with callbacks not yet dealt with; ids only                                                  | `SELECT` on `tenant_id`, `signature_request_id` and the dealt-with time of `app.signature_callback`, with a `SELECT` policy `TO` it that is `USING (true)`                                                                                                                                 |

- `app.record_signature_callback()` repeats the connection lookup itself,
  then finds the open request on that connection with that provider
  reference, within that connection's tenant only. It writes one
  `app.signature_callback` row and a system audit event with ids and codes
  only, in one transaction, and writes nothing else: no status, file or
  value from the body except the event id, which is length-capped and
  limited to printable ASCII. A unique key on request and event id makes a
  repeat `seen`.
- Neither API function sets a tenant, and none returns provider data,
  person ids, file ids or status.

Abuse cases, which S12-54's threat model starts from and the January pen
test covers:

| Case                                                                    | What happens                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged callback                                                         | Fails verification; 204; nothing recorded. Even a verified hint only causes a re-read from the provider                                                                                                   |
| Replayed callback                                                       | Its event id is `seen`: 204, no new job. Outside the timestamp window where the provider signs one                                                                                                        |
| Another tenant's reference, or a provider reference from another tenant | The request lookup is by connection and provider reference together, inside the connection's tenant, so it finds nothing; 204                                                                             |
| Unknown or closed reference                                             | Nothing found, the same dummy verification, 204                                                                                                                                                           |
| A status the request cannot move to                                     | Never taken from the body; a provider status the trigger and `canMoveTo()` refuse leaves the request unchanged, with a code and an audit event                                                            |
| Oversized body                                                          | 413 before more than 64 KiB is read                                                                                                                                                                       |
| A flood of callbacks                                                    | The proxy's per-address limit, the per-reference limit, and one refresh job per request at a time                                                                                                         |
| Provider down                                                           | Refresh jobs retry with backoff, then end with `signature.provider_unavailable`; the status stays as it was, and reconciliation tries again. An expiry is never assumed while the provider cannot be read |
| A hostile file from the provider                                        | Size cap, type check and scan, as for any upload; served only as an attachment with ADR 0047's headers                                                                                                    |
| A leaked callback reference                                             | No log of ours holds it. Alone it can only spend the reference's rate limit, which delays news until reconciliation; it cannot forge a callback without the derived secret. The operator replaces it      |
| A leaked signing link                                                   | It is never stored or logged by us; stronger signer checks, such as a one-time code, are for the agreements ADR in wave 2                                                                                 |

### Outbound

Only the worker talks to a provider; the API never calls one.

- A provider at a public address is reached through the global dispatcher
  (ADR 0010) for API calls. Signed files and evidence are larger than the
  dispatcher's 1 MB body, so their downloads use a client pinned to the
  same configured host, as ADR 0031 does for its downloads, with a 10 MiB
  body cap and 2 minutes per download.
- A self-hosted provider on a private network, which the dispatcher refuses
  by design, is reached only through a client pinned to one configured host
  and port, like SMTP and clamd: HTTPS with certificate verification (an
  operator's own CA file may be named), connections only to that host and
  port, no redirects followed, the same time limits and the 10 MiB cap.
  The dispatcher gains no exception.
- The host and port come from the cell's configuration, set by the
  operator. No tenant setting can name a host.
- The Compose and Helm egress rules allow the worker to reach that host and
  port and nothing new; the API gets no egress to it. The provider itself
  needs no egress except to our callback route, since its own email is
  off. S11-41 (Compose) and S12-11 (Helm) add these rules.

### Providers

- **The first adapter, for Q1 2027, is Documenso, self-hosted.** It is
  TypeScript on Node.js with PostgreSQL, our own stack, so we can review it
  and contribute fixes upstream. Its teams give each tenant its own API
  token and webhook in the open source edition, and it seals completed
  documents with a certificate the operator supplies (all GK). The adapter
  task confirms each of these, the original read-back, the evidence format
  and the external id against the release it pins. If Documenso fails one,
  or any feature we need sits under its commercial `ee` licence, DocuSeal
  is next; the interface makes that one new adapter.
- Both are AGPL-3.0 services in their own containers, talking to us only
  over HTTP. Under ADR 0002 they are not linked, need an OSI-approved
  licence, are listed in the SBOM and are pinned by digest. If we change
  one, our changed source is offered to its users, as its licence asks; we
  send changes upstream instead where we can.
- **One provider instance per cell, one account per tenant.** An operator
  command creates a tenant's team, its API token and its webhook, in the
  same way as `pnpm tenant:create` (ADR 0019), and writes the connection.
  One tenant's token can never reach another tenant's documents.
- The signing page is served on its own host name, never the console's or
  portal's, so it shares no cookie with us. Signers go to it from the
  email's link. No signing view is embedded in our pages; that waits for
  an amendment under ADR 0035, which would need our `frame-src` and the
  provider's `frame-ancestors`.
- The signing page must meet WCAG 2.2 AA. The adapter task checks it with
  axe, a keyboard and a screen reader, adds each gap to the
  [known-issues register](../accessibility/known-issues.md) and offers
  fixes upstream. A signer who cannot use it can sign on paper, and staff
  upload the signed copy instead; agreements (wave 2) provide that route.
- **Commercial providers** (DocuSign, Adobe Acrobat Sign) are available
  only as out-of-process plugins under ADR 0044 (being drafted). They run
  outside the managed service's process and hold their own credentials,
  and the documents they receive make them a separate processor with its
  own terms.
- **The law.** Electronic signatures are valid for most documents in
  England and Wales, as the Law Commission's 2019 report on electronic
  execution of documents found, and are admissible under the Electronic
  Communications Act 2000 (GK). Deeds, which need a witness present, and
  Scotland and Northern Ireland, are for the solicitor to confirm before
  agreements go live.

### Document generation from versioned templates

- **Templates are configuration** (rule 10). Each publish writes an
  immutable `app.document_template_version` row (template id, version,
  kind, audience, merge fields, body, author, time) and a `config_version`
  row with the author and diff. A generated document pins the template
  version it used, by a real foreign key on the record that holds it.
- **The body is structured data, not code or HTML.** A strict schema in
  the contracts allows a closed set of blocks: headings, paragraphs of
  text and merge fields, lists, tables, page breaks, and the tenant's logo
  with its alternative text. Merge fields name stable field ids. Values are
  set as text and never interpreted, so a value cannot change the layout,
  add a link or fetch anything. Bodies are size-capped.
- **Each template has an audience**, one of the projection's audiences
  (`staff`, `reviewer`, `blind_reviewer`, `applicant`). Board packs are
  `staff`; agreements are `applicant`, since the grantee reads them. On
  publish, every merge field must be one that audience may see through the
  audience projection. `aggregate_only` and special category fields are
  refused for every audience, so they never reach a document.
- **At generation**, the publish check is not enough, because what an
  audience may see depends on each record. For every record in the
  document, the worker builds the template audience's projection as ADR
  0004 builds a response: from that record's pinned form version, so a
  field the version hides from reviewers stays out of a `reviewer` or
  `blind_reviewer` document, and from its release state, so decision
  fields (outcome, amount, feedback) reach an `applicant` document only
  once that record's decision is released. The fields used are the
  template's, intersected with that per-record audience projection, with
  the requester's own projection and with the field list in the job
  request.
- **A field that fails the intersection is never filled.** A decision
  field on a record whose decision is not released fails the whole job
  with `document.field_not_released` and produces no file, as ADR 0004's
  rule for email templates fails a send that would fill one. Any other
  field the audience or the requester may not see on that record prints a
  fixed "Not shown", never its value. A blind-review round keeps identity
  fields and files out of any reviewer document.
- The generation tests (S12-12 for the projection, S12-78 for the job)
  include a `reviewer` document for an application whose pinned form
  version hides a field from reviewers, which must print "Not shown", and
  an `applicant` document for an application whose decision is recorded
  but not released, which must fail with `document.field_not_released`.
  Both are generated by a staff requester, who may see every field.
- **Generation is a worker job** through `app.job_request` (S11-67), under
  ADR 0009's rules for jobs that act for a user. The output is an
  `app.file`, stored through the same scan as any file, classified as its
  most sensitive field, and within the 10 MiB ceiling or refused with
  `document.too_large`. Board packs are kept 7 days, downloadable only by
  their requester, every download audited (ADR 0009).
- **Board packs (S12-78) are the first user; agreements (wave 2) the
  second,** where the generated file becomes the `sent` file of a
  signature request.

### PDF library: pdfkit

- pdfkit runs inside the worker, with no network: it receives the data,
  the fonts and the logo as bytes and returns a PDF. A Semgrep rule allows
  importing it only in the renderer, `apps/api/src/platform/documents/generate/`.
- Every PDF is tagged and made in pdfkit's PDF/UA mode: the document
  language and title set, each block kind mapped once to its structure
  element (headings, paragraphs, lists, tables with header cells, figures
  with alternative text), running headers and footers marked as artifacts,
  and reading order following the template.
- Fonts are embedded and subset: Atkinson Hyperlegible Next under ADR 0045's
  font rule, with a fallback font under the same rule for letters it lacks.
  Every character is drawn with an embedded font.
- S12-78 checks its output against PDF/UA-1 with a validator in CI and with
  a screen reader before release. A validator that never ships is a CI tool
  under ADR 0002.
- We never use PDF encryption, forms or JavaScript.
- The pin and its ADR 0002 record are S12-19's, in the lead's dependency
  batch; the record below is what that pin must confirm.

### Retention and erasure

| What                                                           | Kept                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A signed request's `sent` copy, signed file and evidence       | The rule of the record that asked for the signature. For agreements, the wave 2 ADR sets it; the expected default is 7 years after the grant closes (GK: the Limitation Act 1980 allows 6 years for claims on a simple contract and 12 on a deed; for the solicitor to confirm) |
| A declined, expired, cancelled or failed request and its files | 12 months after it closed, ADR 0047's audit floor                                                                                                                                                                                                                               |
| Request, signer and connection rows                            | As long as their files, then purged with them; a connection until it is closed                                                                                                                                                                                                  |
| Callback rows                                                  | 30 days                                                                                                                                                                                                                                                                         |
| Template versions                                              | The life of the tenant, since documents pin them                                                                                                                                                                                                                                |
| Generated board packs                                          | 7 days (ADR 0009)                                                                                                                                                                                                                                                               |

- Erasure under ADR 0027: open requests for an erased signer are cancelled
  at the provider and locally. Until the statutory retention ADR (Q1 2027)
  adds a basis that lets them outlive erasure, signed documents and evidence
  are erased like any other file on the subject's records. A funder that
  must keep a signed agreement therefore declines that part of the request
  outside the system, as ADR 0027 says, rather than running the erasure.
- At the provider, documents are deleted once fetched and checked, and when
  a request is cancelled, declined or expired. Where its API cannot delete
  them, the provider's own retention is set to its shortest (GK).

### Audit and events

- Audit actions (named in S12-12): `platform.signature.requested`, `sent`,
  `viewed`, `signed`, `declined`, `expired`, `cancelled`, `failed` and
  `callback_received`; `platform.document.generated`; template publishes.
  Values are ids, statuses, codes and hashes, never a name, email, IP
  address or file name.
- Sensitive reads: every download of a signed file (`platform.file.downloaded`),
  of evidence, which needs a permission of its own, and of a generated
  document.
- Each status change publishes a versioned event through ADR 0034, such as
  `platform.signature_request_signed.v1`, with ids and the status only. The
  module that asked for the signature acts on it in its own handler.

### Not decided here

- Agreements, their versions, wet-signature upload, signer authentication
  beyond the provider's default, and deeds: wave 2's agreements ADR.
- Statutory retention and legal hold: the Q1 2027 ADR.
- An embedded signing view: an amendment under ADR 0035.
- Commercial providers: ADR 0044.

## Consequences

- Rule 1, portable: Documenso and pdfkit run anywhere PostgreSQL and
  Node.js do. No provider-specific code lives outside its adapter, and the
  self-hosted provider is swappable for another adapter.
- Rule 2: `app.signature_connection`, `app.signature_request`,
  `app.signature_signer`, `app.signature_request_file`,
  `app.signature_callback` and `app.document_template_version` each have
  `tenant_id`, row-level security and a cross-tenant denial test (S12-62).
- Rule 3: signers and files are real composite foreign keys; there is no
  text-typed or polymorphic reference.
- Rule 4: sent, viewed, signed, declined, expired, cancelled and failed are
  audited with ids and codes only, and every download is; evidence
  downloads are sensitive reads.
- Rule 5: every new column is classified with a retention rule that agrees
  with ADR 0027 for signed documents and evidence; evidence and signer
  links are personal.
- Rule 6: the sender comes from the session; signers are re-checked against
  the party contract at request and at send.
- Rule 8: sending an agreement never releases a decision; agreements are
  only for decisions already released, through their own action. Decision
  fields reach an `applicant` document only once that record's decision is
  released: generation checks each record's release state, whoever asks,
  and fails with `document.field_not_released` rather than fill one early.
- Rule 9: a declined or expired signature never cancels an award on its
  own. It is shown to staff, and a person decides.
- Rule 10: templates are versioned configuration, and documents pin the
  version they used.
- The new contracts entry point, `packages/domain/src/documents/index.ts`,
  imports the jitless switch before anything else, and S12-12 adds
  `documents` to the jitless test's list of entries.
- Amendments, recorded here and applied in a later housekeeping change:
  ADR 0047 gains one public raw-body route; ADR 0028 gains one rate-limit
  bucket; ADR 0003 gains three approved definer functions; ADR 0030's
  access-log rule logs `/api/public/signature-callbacks/` alone, as it
  does `/api/auth/`; and ADR 0004's request logger redacts the reference
  in the callback path, as it redacts tokens in auth paths.
- S12-62's table list grows by the connection, signer, file join and
  callback tables, and file links move from columns on the request to the
  join table. S12-12 and S12-85 follow the per-connection reference and the
  two callback functions.
- The worker image gains pdfkit and its fonts. The provider is a new
  optional service per cell, with its own database and certificate, that
  the operator runs and upgrades.
- The worker is the one place that sends documents out of the cell; a
  tenant can see every document sent through its audit log.

## Dependency check

No dependency is added by this ADR. S12-19 pins pdfkit and the first
adapter task pins the provider image, each recording the release, its
date, the advisories of the last 12 months and the installed size, as
ADR 0002 asks. What they must confirm (GK):

| Package or service                   | Licence                                        | Maintainers                                        | Last release                      | Open advisories                  | Size                                     | Notes                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdfkit (chosen)                      | MIT                                            | The foliojs organisation, which also keeps fontkit | Several releases in 2024 and 2025 | None known against pdfkit itself | Tens of megabytes installed with fontkit | Some releases depend on crypto-js, which is discontinued and only used for PDF encryption, which we never use; the pin checks the resolved tree and its install scripts |
| pdf-lib (not chosen)                 | MIT                                            | One maintainer                                     | 1.17.1, November 2021             | None known                       | Small                                    | No tagged PDF; unmaintained                                                                                                                                             |
| @react-pdf/renderer (not chosen)     | MIT                                            | Community                                          | Active                            | None known                       | Medium                                   | No structure tags                                                                                                                                                       |
| Typst (not chosen)                   | Apache-2.0                                     | Typst GmbH and community                           | Active; 0.14 in 2025              | None known                       | A binary of tens of megabytes            | Best tagged output; a subprocess and a template language                                                                                                                |
| Chromium with Puppeteer (not chosen) | BSD-3-Clause, Apache-2.0                       | Google                                             | Weekly                            | Frequent, as for any browser     | Hundreds of megabytes                    | Largest attack surface                                                                                                                                                  |
| Documenso (chosen, a service)        | AGPL-3.0; `ee` code under a commercial licence | Documenso, a company, and community                | Frequent                          | To check at pin                  | One container and a database             | Separate service; not linked                                                                                                                                            |
| DocuSeal (fallback, a service)       | AGPL-3.0; paid edition features                | DocuSeal, a company                                | Frequent                          | To check at pin                  | One container                            | Separate service; not linked                                                                                                                                            |
