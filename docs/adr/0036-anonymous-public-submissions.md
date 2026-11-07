# ADR 0036: Anonymous public submissions

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Every write so far comes from a signed-in member: the tenant is the
session's, the actor is the session's member, and row-level security and
the policy module stand between the request and the data. `forms` v1 (March 2027) adds forms that anyone can answer without an account, on the portal or
embedded in a funder's website
([ADR 0035](0035-embeds-and-custom-domains.md)). That is the first write in
the product with no session and no tenant set by the request.

The suite plan disagrees with itself. Its forms engine section (2.6) lists
anonymous public forms under "not now" for the MVP1 engine, while its
`forms` section (3.13) puts them in `forms` v1, protected by rate limits and
an accessible bot check: proof of work, not reCAPTCHA.

Constraints:

- [ADR 0019](0019-tenant-addresses-public-pages-and-theming.md): no
  anonymous request runs with a tenant set. Anonymous reads go through
  approved definer functions that resolve the tenant from the slug inside
  themselves.
- [ADR 0003](0003-query-builder-and-migrations.md): an approved definer
  function has a `NOLOGIN` owner, `search_path = pg_catalog, pg_temp`,
  `EXECUTE` revoked from `PUBLIC`, column grants and a policy `TO` its owner
  on each table it touches, and an entry in the catalogue test.
- [ADR 0004](0004-api-contract.md) and the route rules: public routes live
  under `/public/…` with no permission or scope, request schemas are strict
  and never name a tenant or actor, and problem details never echo a
  submitted value.
- [ADR 0028](0028-idempotency-keys.md) scopes idempotency keys by
  membership, which an anonymous request has none of, leaves public routes
  to this ADR, and refuses an idempotent public route until it is accepted.
  Its `app.request_limit` holds rate-limit counters keyed by client.
- [ADR 0030](0030-files-and-reverse-proxy.md): the proxy checks the session
  before it reads an upload body, so an anonymous client cannot make the
  proxy or the API hold a file.
- [ADR 0033](0033-consent-and-communications.md): marketing needs recorded
  consent and passes the may-contact check at send time; it left to this
  ADR how a public form records consent.
- [ADR 0027](0027-erasure-across-modules-and-audit.md): answers take their
  classes from the pinned form version, and a table with personal values
  and no known subject is "unlinked", with a fixed retention of 12 months or
  less. [ADR 0032](0032-equality-and-monitoring-data.md): `aggregate_only`
  answers are never shown per response, only counted under its disclosure
  rules.
- [ADR 0016](0016-modular-suite-and-shared-warehouse.md) and
  [ADR 0024](0024-no-tool-on-by-default.md): `forms` is on for a tenant only
  when its `app.tenant_module` row says so.
- [Architecture rules](../ARCHITECTURE.md) 2 to 7 and 9.
- Dependencies are frozen: nothing is added outside the lead's planned
  batches, and each needs an [ADR 0002](0002-licence-and-dependency-policy.md)
  record.

## Options considered

The write path:

1. **Set the tenant from the slug for the submit route.** Rejected by ADR
   0019 for reads; for a write it would let any bug in the route write
   anywhere in that tenant as `app_api`.
2. **A public login role with its own grants and policies.** A new
   credential and policy set for one insert.
3. **One approved definer function that checks everything and writes one
   response.** The pattern ADR 0019 set for reads, with the checks in one
   place the catalogue test can see.

The bot check:

4. **A third-party service** (reCAPTCHA, hCaptcha, Turnstile). Sends every
   respondent's browser to another company, sets or reads its cookies, and
   its fallbacks are visual or audio puzzles that fail disabled people.
5. **Our own visual or audio puzzle.** The same accessibility failure.
6. **Rate limits alone.** Stop one address, not a spread of addresses
   sending a few each.
7. **Proof of work from a library**, compared below.
8. **Proof of work on Node.js and Web Crypto built-ins.** Roughly a hundred
   lines on each side, no dependency, and our own text and markup.

Proof-of-work libraries, compared under ADR 0002 (see the dependency check):
ALTCHA (MIT) and Cap (Apache-2.0) are self-hosted and suitable;
mCaptcha (AGPL-3.0) needs its own server and database; Friendly Captcha
verifies through its company's service unless a paid server is bought.

The respondent token:

9. **Made by the server and returned once.** Only its hash is kept, so a
   retry after a lost response cannot be given it again.
10. **Made by the browser before sending.** The respondent has it before
    the request leaves, so it survives a lost response and can scope the
    idempotency key.

Where idempotency is kept:

11. **`app.idempotency_key`.** Its rows are keyed by membership and written
    by `app_api` in a tenant transaction, neither of which exists here.
12. **On the response row.** One row written by the function, in the same
    insert, with the database's unique index doing the work.

## Decision

Options 3, 8, 10 and 12.

### Scope

Decided: anonymous public forms are in `forms` v1 through this ADR. The
plan's "not now" stays true for grants: the apply journey stays signed-in
only, and no grants route takes an anonymous answer.

- A form opts in through its respondents setting (`signed_in`, `anonymous`
  or `both`), which is configuration: changing it needs
  `forms.forms.manage`, and publishing needs `forms.forms.publish`, each
  writing a `config_version` ([rule 10](../ARCHITECTURE.md)).
- Decided: the setting is also recorded on each published version.
  Publishing copies the form's setting into the version's `respondents`
  column, which is immutable with the rest of the version. A version takes
  anonymous answers only if it was published as `anonymous` or `both` and
  the form's current setting is still one of those. So switching a form to
  `anonymous` takes effect only when a version is next published, through
  the checks below, and switching it back to `signed_in` closes it to the
  public at once. The alternative, refusing the switch while any published
  version holds a field anonymous forms may not take, was rejected: it puts
  the guard on a changeable row, which every later edit must remember.
- Anonymous forms take no file fields in v1, because ADR 0030 lets no
  anonymous client make the proxy or the API hold a file.
- Anonymous forms take no `aggregate_only` fields until `forms` has ADR
  0032's disclosure rules.
- Publishing a version as `anonymous` or `both` with a file or
  `aggregate_only` field is refused by the server, and refused again by the
  database, which will not store such a published version.
- Respondents see the fields of the `respondent` audience (S11-43); staff
  read responses through the same audience projection as any other.

### Reading the form

Before anything is answered, the browser reads the form, and the API needs
the published definition to validate against. Both go through a read in
ADR 0019's pattern, joining ADR 0003's approved definer functions:

| Function                                            | Callable by | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Its owner holds                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forms.public_form(slug, form_id, form_version_id)` | `app_api`   | Nothing, never a tenant id, unless the tenant is active with `forms` switched on, and the form, looked up by tenant and id together, takes anonymous answers, is not archived, is open now and its latest published version was published for anonymous answers. Then: with no `form_version_id` (the default), the form's title, description and confirmation message with that latest version's id and definition; with one, the same for that version if it is a published version of this form published for anonymous answers, and otherwise only the fixed code `form_changed`, with no definition | `SELECT` on `id`, `slug` and `status` of `app.tenant`; on `tenant_id`, `module` and `enabled` of `app.tenant_module`; and on the columns it reads of `forms.form` and `forms.form_version`; each with a `SELECT` policy `TO` it that is `USING (true)` |

### Submitting: one approved definer function

The only way an anonymous response reaches the database:

| Function                                                                                                                            | Callable by | Returns                                                                                                                            | Its owner holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms.submit_public_response(slug, form_id, form_version_id, answers, token_hash, key_hash, request_hash, proof_hash, request_id)` | `app_api`   | A response id, or one of the fixed codes `not_found`, `form_changed`, `key_reused` and `proof_used`; never a row or a stored value | `SELECT` only on the columns it checks: `id`, `slug` and `status` of `app.tenant`; `tenant_id`, `module` and `enabled` of `app.tenant_module`; and the respondents setting, archive time, opening and closing times and status columns of `forms.form` and `forms.form_version`, plus `id` and the idempotency columns of `forms.response`. `INSERT` only on the columns it writes of `forms.response` and `forms.respondent_token`, and of `app.audit_event` (below). A policy `TO` it on each, with no `UPDATE` or `DELETE` anywhere |

- Its owner is `owner_forms_submit_public_response`, `NOLOGIN`, with
  `search_path = pg_catalog, pg_temp`, every name qualified, `EXECUTE`
  revoked from `PUBLIC` and granted to `app_api` alone, and
  `lock_timeout = '5s'` set on the function.
- It runs outside the policy module, so it is the only guard on this path.
  In this order it: resolves the tenant from the slug, active tenants only,
  comparing the slug exactly; checks `forms` is switched on in
  `app.tenant_module`; looks the form up by that tenant's id and the form id
  together, so a slug with another tenant's form id finds nothing; checks
  the form takes anonymous answers, is not archived, is open now and its
  latest published version was published for anonymous answers; checks
  `form_version_id` is a published version of that form whose own
  `respondents` is `anonymous` or `both`; then writes one submitted
  response pinned to exactly that version ([rule 7](../ARCHITECTURE.md)),
  its respondent token row and its audit event, in one transaction. It
  never substitutes another version.
- The API passes as `form_version_id` exactly the version id whose
  definition `forms.public_form()` returned to it and `validateAnswers()`
  checked, and no other value. The function's version check repeats
  `forms.public_form()`'s, so the two cannot disagree: published versions
  are immutable, and a version that fails either check is refused, not
  replaced. If a new version is published while someone is answering,
  their response is checked against, and pinned to, the version they
  answered, and is still accepted.
- Every not-found case (unknown slug, suspended tenant, `forms` off, unknown
  form, signed-in-only, archived, closed or unpublished form) returns
  `not_found` and writes nothing. A version id that is not a published
  version of that form, or was published for signed-in respondents only,
  returns `form_changed` and writes nothing.
- The request never sets a tenant. Like ADR 0019's functions, it resolves
  the tenant inside itself, so ADR 0003's tenant sources are unchanged.
- `app_api` cannot write an anonymous response or a token any other way:
  its `INSERT` policy on `forms.response` allows signed-in responses only,
  and it has no `INSERT` on `forms.respondent_token`.
- The catalogue test knows the two functions by one entry each, by object
  and reason: `forms.submit_public_response(…)`, "the one write path for
  anonymous responses; resolves the tenant from the slug and sets none",
  and `forms.public_form(text, uuid, uuid)`, "a published, open anonymous
  form or one of its anonymous versions by slug and id, with no tenant
  set".

### The routes and validation

Under `/public/tenants/{slug}/forms/{form id}`: read the form, fetch a
proof-of-work challenge, and submit. Each answers the same 404 for every
not-found case, so the routes cannot be used to discover forms or tenants.

The submit route, in this order:

1. The per-client rate limit (below).
2. The body size cap, then the strict request schema, which requires the
   form version id the page was given, the `Idempotency-Key` header and the
   respondent token.
3. The proof of work, verified and then used up at once through its
   single-use marker (below), or, for a request with no proof, the fallback
   (below) and its per-client limit. A proof already used gets the
   proof-invalid problem here, before any form or tenant bucket is touched.
4. The per-form and per-tenant rate limits, counted only now: the checked
   buckets for a request whose proof has just been verified and used up,
   the fallback's own buckets for a request with none.
5. `forms.public_form(slug, form_id, form_version_id)` with the version id
   from the body, which returns that version's definition or
   `form_changed`.
6. Cleaning and `validateAnswers()` from the shared form engine against that
   definition ([rule 6](../ARCHITECTURE.md)).
7. The keyed hashes, then `forms.submit_public_response()` with the same
   version id, and the function's code mapped to a problem.

- Only cleaned answers reach the database, and the database's
  clean-answers check is a backstop, not the validation.
- Size caps: the submit body is at most 256 KiB, checked before parsing,
  below the proxy's 1 MiB first layer. Each answer is held to the form
  engine's own caps for its field type, and the number of answers to the
  engine's field limit. A larger body gets 413.
- Problems: `404` for not found; `/problems/form-changed` (`409`) when the
  version answered is not, or is no longer, one the form takes anonymous
  answers against, after which the page reads the form again, keeps every
  answer whose field id still exists, and asks the person to check and
  send again; a `400` validation problem by stable field id;
  `/problems/proof-invalid` (`400`) for a malformed, expired, wrongly bound
  or already used proof, or a missing one while the fallback is switched
  off, in one type so a caller learns nothing from the difference; `429`
  with `Retry-After` for a rate limit; and ADR 0028's
  `/problems/idempotency-key-reused` and
  `/problems/idempotency-key-in-progress`. None echoes an answer, the
  token, the key or the proof.
- A success answers `201` with the response id and the form's confirmation
  message, and nothing else.

### The anonymous respondent token

- **What it is for:** a reference the respondent can quote to the funder to
  have their response found, for a subject access or erasure request under
  ADR 0027, and the scope of their idempotency key (below). Self-service
  withdrawal would need a second write function and is left to a later ADR.
- **How it is made:** 32 random bytes from the browser's
  `crypto.getRandomValues()`, made once per submission before it is sent,
  and sent as a base64url field in the JSON body. The schema takes exactly
  43 base64url characters. A weak token chosen by a hostile client harms
  only that client.
- **What is kept:** only `token_hash`, an HMAC-SHA-256 of the token under a
  server key held outside the database and used for nothing else, unique
  across the deployment. The token itself is never stored, logged or
  returned.
- **Lifetime:** `expires_at` is set by the database to the response's
  `retain_until`, so the token never outlives what it refers to. It is
  revoked when the response is erased.
- **Where it travels:** in the request body only, never in a path or query
  string that could reach a proxy or access log, and never as a cookie.
  After submitting, the page shows it as the response reference with a
  "Copy reference" button and keeps it nowhere.
- **What it links to:** one response. No column links a token to a party,
  and staff cannot link an anonymous response to a party record. Staff find
  a response by its reference in the console: the API computes the hash and
  reads under the tenant's row-level security, as a sensitive read.

### Accessible proof of work, not reCAPTCHA

No third-party bot service, and no visual or audio puzzle.

The check, in the browser:

- It starts by itself when the form loads, in a Web Worker, with no action
  from the person, and keeps the page responsive while it runs.
- It is silent while the person answers. If they press "Submit response"
  before it has finished, a status line under the button, in a polite live
  region, says "Checking your browser before sending your response" and
  updates its text at most every 5 seconds. Under
  `prefers-reduced-motion` nothing moves; the status is text either way, and
  it wraps at 320px and 200% zoom.
- Fallback for very slow devices or a worker that cannot start: if the check
  has not finished 30 seconds after the person pressed the button, the
  response is sent without a proof, and the function receives a null
  `proof_hash`. Such responses are stored with no proof recorded and shown
  to staff as "Sent without the browser check" (see spam handling), under
  their own small rate limits, so they never use up the budget for checked
  responses.
- The fallback has a platform switch, `public_forms_no_proof`, on by
  default and read on every request, which the operator turns off during an
  attack. The form read tells the page whether the fallback is open. While
  it is off, the page does not send early: it keeps the check running and
  the status line updated, and a request with no proof gets the
  proof-invalid problem. Outside an attack nobody is stopped by the check,
  and in either case no answer is lost.

The challenge and its verification, on the server:

- The challenge route returns a challenge naming the slug, the form id, an
  issue time, an expiry 10 minutes later, a difficulty and 16 random bytes,
  signed with HMAC-SHA-256 under a server key used for nothing else. No
  table is needed to issue one.
- The browser must find 16 small solutions, each a nonce that makes the
  SHA-256 of the challenge, its index and the nonce start with the
  difficulty's number of zero bits. Several small puzzles vary less in time
  than one large one.
- The API checks the signature in constant time, the expiry, that the slug
  and form id match the submit route's, and every solution: one HMAC and 16
  hashes.
- Replay is refused at verification, whatever happens to the request
  afterwards. Once the signature, expiry, binding and solutions check out,
  the API upserts a marker in `app.request_limit`: bucket
  `public_form_proof`, keyed by `proof_hash`, the SHA-256 of the signed
  challenge, with a limit of 1. Its `window_start` is the challenge's signed
  issue time, not the current window, so every use of one challenge lands
  on the same row, and its row expires 24 hours after issue, long after the
  challenge. The upsert is one atomic statement, so of two uses, even at
  the same moment, only the first gets a count of 1. Any later use gets the
  proof-invalid problem before a form's or tenant's bucket is counted.
- So a proof is spent by its first verified use, even when that request is
  then refused for a rate limit, a changed form, invalid answers or a code
  from the function. The page starts a new check as soon as the submit route
  answers with anything but success, so correcting an answer rarely waits
  for it, and a retry after a lost response solves a new challenge too,
  which idempotency allows (below).
- The response still stores `proof_hash` under a unique index, and the
  function returns `proof_used` for a hash already stored, as a backstop
  should the marker ever be missed. A crawler that collects challenges gets
  one checked request per challenge at most, within 10 minutes, under the
  rate limits.
- The difficulty is a platform setting, not a tenant one, with fixed bounds.
  Its default is set by measurement so that a low-end phone finishes in
  about 2 seconds. An operator may raise it during an attack, which raises
  the cost of every checked request, the only kind that counts against a
  form's or tenant's checked budget.

### Rate limits

Counters in `app.request_limit` (ADR 0028), shared by every API instance,
each answering `429` with `Retry-After` and never saying which limit was
hit. The client address comes from the trusted proxy list only (ADR 0030),
with an IPv6 /64 counted as one address.

| Bucket                        | Keyed by       | Counts                                       | Starting limit              |
| ----------------------------- | -------------- | -------------------------------------------- | --------------------------- |
| `public_form_challenge`       | Client address | Every challenge request                      | 60 an hour                  |
| `public_form_submit`          | Client address | Every submit request, before anything else   | 10 an hour                  |
| `public_form_no_proof`        | Client address | Every submit request with no proof           | 2 an hour                   |
| `public_form`                 | Form id        | Submit requests whose proof has been checked | 300 an hour                 |
| `public_form_tenant`          | Tenant slug    | Submit requests whose proof has been checked | 1,000 an hour               |
| `public_form_no_proof_form`   | Form id        | Submit requests with no proof                | 20 an hour                  |
| `public_form_no_proof_tenant` | Tenant slug    | Submit requests with no proof                | 60 an hour                  |
| `public_form_proof`           | Proof hash     | Verified uses of one proof                   | 1, for the challenge's life |

- Only the client-address buckets are counted before the proof is checked,
  and `public_form` and `public_form_tenant` are counted only after the
  proof has been verified and its `public_form_proof` marker taken. A
  request with a bad proof, an already used one, or none while the fallback
  is off, is refused before it touches a form's or tenant's bucket, so
  sending garbage, or one solved proof over and over, under a real slug
  costs the sender a client-address budget and nothing else. Each verified
  proof adds at most one to each of the two, whatever happens to its
  request afterwards. The slug and form id that key them are the ones the
  verified challenge was bound to.
- A request with no proof counts only against the fallback's buckets. Using
  them up closes the fallback for that form or tenant for the hour, and
  leaves checked submissions open.
- An unknown slug or form id counts the same as a real one, so the limits
  cannot be used to discover forms or tenants.
- The numbers are fixed constants beside the other limits, reviewed in use.
  No window is longer than 12 hours, and no tenant can change them.
- This extends ADR 0028: a key may now be a form id or a slug, which are not
  client keys, hashed in the same way. They hold no personal data.
- It extends ADR 0028 once more for `public_form_proof`: a key may be a
  proof's hash, and that bucket's `window_start` is the challenge's signed
  issue time rather than the start of the current window. Its window is the
  challenge's 10-minute life, well under the 12-hour cap, and it holds no
  personal data. The table's fixed list of bucket names gains all eight
  names above.

### Idempotency without a membership

Decided: the `Idempotency-Key` header works as in ADR 0028, scoped to
tenant, form and respondent token, and stored on the response row.

- The header, its format and its problems are ADR 0028's. The submit route
  is the one idempotent public route; this ADR lifts ADR 0028's refusal for
  it alone.
- `key_hash` is HMAC-SHA-256, under the token hash's server key, of the
  route id, the respondent token and the key. So the same key with another
  token, form or tenant is a new key. `forms.response` keeps it in
  `idempotency_key_hash`, unique per tenant and form among anonymous rows.
- `request_hash` is ADR 0028's canonical request hash, over the route,
  path parameters, form version id and cleaned answers. The proof and the
  token are left out, so a retry that had to solve a new challenge is still
  the same request.
- A retry after a lost response must solve a new challenge, since its first
  proof was used up at verification; the new proof does not change
  `request_hash`. The function looks the key up first. The same key and
  request return the first response id and write nothing; a different
  request returns `key_reused`, as does a token already used on another
  response. Two identical requests in flight meet on the unique index: the
  second waits, then replays, or after 5 seconds gets the in-progress
  problem from the lock timeout.
- Neither the key nor its hash is ever echoed, logged or returned.
- The key's row lives as long as the response, which costs nothing, since
  the response is kept anyway.

### Spam

- Code never drops, hides or deletes a response. A response sent without a
  proof is stored like any other and shown to staff with that fact, which
  they can filter on. That is a flag for attention, not a decision
  ([rule 9](../ARCHITECTURE.md)).
- Staff with `forms.responses.manage` mark a response as spam, which keeps
  it out of lists, exports and the warehouse, and can undo it. Each is a
  named action with an audit event (`forms.response.marked_spam`,
  `forms.response.unmarked_spam`). A response marked as spam leaves at its
  retention end, or sooner through erasure.
- No hidden honeypot fields. A field hidden from sight is still reached by
  some screen readers, voice control and browser autofill, which would mark
  real people as bots.
- No email is sent in v1 to an address taken from an anonymous form, not
  even a receipt, and an anonymous form records no consent and creates no
  party. A form that needs to contact people or record their consent uses
  signed-in respondents, where ADR 0033's portal route records it through
  the party contract.
- If a later version adds a spam re-check or a staff notification as a job,
  its payload holds ids only ([ADR 0009](0009-background-jobs.md)).

### Audit

Decided: each anonymous submission writes one audit event,
`forms.response.submitted`, inside the function, in the same transaction:
actor kind `system` with no actor id, the request id, the response id, and
the form and version ids. No answer, token, key, proof or client address.

- The function's owner holds `INSERT` on exactly the audit columns it sets,
  never `occurred_at` or `retain_until`, with an `INSERT` policy `TO` it
  that allows only that action with the `system` actor, and `SELECT` on the
  `app.retention_policy` columns the retention trigger reads, with a
  `SELECT` policy `TO` it, as ADR 0019 arranged for `app_worker`.
- A refused submission writes nothing, and a rate-limit refusal is a
  security event in the logs, not an audit event (ADR 0028).

## Consequences

- This extends ADR 0019 (a public write, in the same pattern as its reads),
  ADR 0003 (two approved functions; no new tenant source) and ADR 0028
  (public idempotency, buckets keyed by form and tenant, and a single-use
  proof marker keyed by the challenge), and settles
  the question ADR 0033 left. Each gains an "Extended by ADR 0036" line when
  this ADR is accepted, and none is edited before then. ADRs 0006 and 0022
  are unchanged: the policy for embedded forms is ADR 0035's.
- Rule 2: `forms.response` and `forms.respondent_token` have `tenant_id`,
  forced row-level security, a policy for every command and cross-tenant
  denial tests. The two functions are named approved functions, not
  exceptions to row-level security. A test shows a tenant with `forms` off
  gets nothing written, and that one tenant's slug with another tenant's
  form id writes nothing.
- Rule 3: the response pins its version through a composite foreign key,
  `(tenant_id, form_id, form_version_id)` to `forms.form_version`; the token
  references `(tenant_id, response_id)`. Checks hold the route, status,
  spam state and a version's `respondents` to their values, allow a token
  only on an anonymous response, and keep every hash at 32 bytes. A trigger
  refuses an anonymous response pinned to a version not published for
  anonymous answers, and a published version recorded as `anonymous` or
  `both` that holds a file or `aggregate_only` field.
- Rule 4: each anonymous submission is audited as above; staff reads of
  responses, and reads by reference, are sensitive reads; marking and
  unmarking spam are audited.
- Rule 5: every column of both tables is classified with a retention rule.
  Answers take their classes field by field from the pinned version
  (S11-43). The hashes are personal, as pseudonymous identifiers. Anonymous
  responses have no party subject: they are unlinked under ADR 0027, so an
  anonymous form's retention is capped at 12 months, and a response that
  turns out to identify someone is found by its id or reference and erased
  by field class as ADR 0027 sets out.
- Rule 6: answers are validated with the shared form engine before the
  function runs; no actor exists, and none is taken from the request.
- Rule 7: every response is pinned to the published version it answered,
  which is the version its answers were validated against. Tests must show
  that answers checked against one version can never be pinned to another:
  in the database, the function pins exactly the version it is given, never
  the latest, and refuses with `form_changed`, writing nothing, a version of
  another form, a draft, or a version published for signed-in respondents;
  in the API, a response sent against version 1 while version 2 is the
  latest is validated against version 1's definition and pinned to version
  1, and a version id `forms.public_form()` refuses gets the form-changed
  problem without the function being called.
- A version's `respondents` is fixed at publishing. Tests must show that a
  signed-in form with a published version, switched to `anonymous` without
  publishing again, takes no anonymous response through either function,
  and that the database refuses a published version recorded as
  `anonymous` or `both` that holds a file or `aggregate_only` field.
- Rule 9: no code marks, hides or removes a response; staff do.
- New contracts entry points that build on this ADR
  (`modules/forms/src/contracts/`, S11-52) import the zod switch in
  `packages/domain/src/jitless/` first and are covered by the jitless test.
- `forms.response` gains `idempotency_key_hash`, `request_hash` and
  `proof_hash`, and `forms.form_version` gains `respondents`, beside the
  columns S12-44 plans. No table is needed for challenges.
- The API gains the `public_forms_no_proof` platform switch beside the
  difficulty setting, with the same rule: an operator setting, never a
  tenant one.
- The API gains two server keys held outside the database, read through
  `readSecret`: one signs challenges, the other keys the token and
  idempotency hashes. Each is distinct from the rate-limit key. The setting
  names are fixed when the forms server is built, and added to the Compose,
  Helm and hardening-guide lists then.
- The roles script gains `owner_forms_public_form` and
  `owner_forms_submit_public_response`, with a roles version bump.
- Requests with no proof, a bad one or an already used one cannot close a
  form or a tenant: they never reach the checked per-form and per-tenant
  buckets, because a proof is used up by its first verified request before
  either is counted. An attacker with many addresses can still use up the
  fallback's small buckets, which closes only the fallback for that hour,
  and the operator can turn the fallback off for the whole platform while
  the attack lasts, at the cost of making very slow devices wait for the
  check. To use up a form's or a tenant's checked budget, an attacker must
  solve a new challenge for every request it counts, 300 for a form or
  1,000 for a tenant in an hour, and raising the difficulty raises that cost
  per request. We accept that residual risk: staff and the operator see the
  security events, and no limit is ever lifted for a tenant.
- The cost of single use falls on the respondent only as a fresh check
  after a refused or lost submission, which the page starts at once and
  which takes about 2 seconds on a low-end phone.
- The work this creates: S11-52 (the routes, the token, challenge and proof
  schemas, the codes and problems, including `form_changed`), S12-44 (the
  tables, both functions and their tests), S12-59 (the routes,
  verification, the single-use marker, hashing, limits, the fallback switch
  and the staff actions, with a test that one verified proof sent again and
  again with invalid answers gets the proof-invalid problem after its first
  use and raises `public_form` and `public_form_tenant` by at most one
  each), S12-65 (the console's reference search and spam actions, and
  saying that a change of respondents takes effect at the next publish)
  and S12-89 (the portal and embed pages, the check in the browser, a new
  check after any refused submission, and reloading the form on
  `form_changed`).

## Dependency check

No dependency is added. HMAC-SHA-256 and SHA-256 come from `node:crypto` on
the server and the Web Crypto API in the browser, and random bytes from
`crypto.getRandomValues()`.

The libraries compared, recorded as candidates only. Their versions,
advisories and provenance would be recorded in full if a later ADR ever
adopted one.

| Candidate                          | Licence                  | Against AGPL-3.0-or-later (ADR 0002) | Maintenance                   | Needs a third-party service                               | Outcome                                                                                                                       |
| ---------------------------------- | ------------------------ | ------------------------------------ | ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ALTCHA (widget and server library) | MIT                      | Allowed                              | Active, with regular releases | No; self-hosted                                           | Not chosen: its own widget markup and text, which we would restyle and rewrite to our content style and test under our policy |
| Cap (widget and server library)    | Apache-2.0               | Allowed                              | Active, but a young project   | No; self-hosted                                           | Not chosen: the same, with a shorter record                                                                                   |
| mCaptcha                           | AGPL-3.0                 | Allowed per package, with a reason   | Releases have slowed          | Its own server and database to run                        | Not chosen: a new service for a small check                                                                                   |
| Friendly Captcha                   | MIT (widget)             | Allowed                              | Active                        | Yes: its company's verification service, or a paid server | Refused: sends respondents' requests to a third party                                                                         |
| Our own, on built-ins              | Ours (AGPL-3.0-or-later) | Not applicable                       | Ours to maintain              | No                                                        | Chosen                                                                                                                        |
