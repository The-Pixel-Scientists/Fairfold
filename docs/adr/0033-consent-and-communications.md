# ADR 0033: Consent and communications

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

MVP1 sends only service email: sign-up and sign-in messages from the auth
module, and release emails from the grants module's outbox,
`grants.decision_email`, through the platform's SMTP sender
([ADR 0020](0020-release-emails-without-a-worker.md)). From December the
suite starts to send mail that promotes a funder's work: `crm` lists and
`forms` in wave 1, then `engage` newsletters, `fundraising`, `membership`
and `volunteers`. That mail is direct marketing, and the law treats it
differently from service mail:

- electronic mail marketing to an individual needs their prior consent, or
  the soft opt-in, under regulation 22 of the Privacy and Electronic
  Communications Regulations (PECR) (GK);
- a person may object to direct marketing at any time, and the objection is
  absolute (UK GDPR Article 21(3)) (GK);
- large mailbox providers expect one-click unsubscribe on bulk mail
  ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)) and act on it within
  two days (GK).

What already exists:

- `party.consent` ([ADR 0017](0017-bespoke-crm-party-core.md)): one
  append-only row per change, naming the person, a purpose from a checked
  list (today only `future_funding`), a channel (`email`, `sms`, `phone` or
  `post`), `given` or `withdrawn`, the privacy notice version, the source
  (`portal` or `staff`) and the time. The current state is the latest row
  for each purpose and channel. This ADR builds on that table and does not
  replace it.
- [ADR 0027](0027-erasure-across-modules-and-audit.md) keeps consent rows on
  erasure and leaves one question to this ADR: what a suppression keeps once
  the person's other data is erased.
- The SMTP sender (S02-16, `apps/api/src/email/`) sends plain text to one
  checked address, refuses any control character in a header, and answers
  with a failure code, never a message.

Facts about law and mail providers below rest on general knowledge where
marked (GK). None of them is a legal conclusion; each goes to the solicitor
(S11-03) before the work that depends on it is built.

## Options considered

Where the consent check runs:

1. **In the screen or the module that builds the audience.** Each module
   repeats the rules, and an audience built on Monday mails on Tuesday a
   person who withdrew on Monday night.
2. **In a database trigger on each module's outbox.** Every module's table
   would depend on party's, and the database cannot compute the keyed hash
   that suppressions need (below).
3. **One party server contract, called by the sender at the moment of
   sending.** One implementation, always the current state, and no module
   can skip it, because the sender is the only way out.

What a suppression keeps once the person is erased:

4. **The plain address.** Personal data that survives the erasure the person
   asked for, readable in every copy.
5. **An unkeyed hash of the address.** Email addresses are guessable, so a
   dictionary reverses the hash; it protects nothing.
6. **A keyed hash (HMAC-SHA-256) under a per-tenant key held outside the
   database.** Without the key no one can test a guess; with it the sender
   can refuse a send without knowing who the suppression was for. Costs: a
   key to escrow, and old key versions that can never be retired.
7. **Nothing.** A person who objected, was erased, and is later imported
   again from a spreadsheet gets marketing again.

The unsubscribe link:

8. **A random token stored in a table.** A row per message, and the public
   route would have to look a token up before it knows the tenant.
9. **The address and an HMAC in the link.** Puts the address into links,
   proxy logs and the records of mail scanners.
10. **Authenticated encryption of ids under a key for this purpose alone.**
    Nothing stored per message, nothing readable in the link, and no change
    possible without the key.

## Decision

Options 3, 6 and 10.

### Purpose on every template

- Every email template version carries `purpose`, `transactional` or
  `marketing`, `NOT NULL` with a `CHECK`, and no default. The migration adds
  it with `DEFAULT 'transactional'` only to fill existing versions, the
  release email templates among them, and drops the default in the same
  migration (`ALTER COLUMN purpose DROP DEFAULT`). Every new version must
  then name its purpose: an insert without one fails on `NOT NULL`, so code
  or a request that leaves it out cannot fall back to the purpose that skips
  the consent check. Each later module's template table takes the same
  column with the same check and no default. A database test proves that
  inserting a version without `purpose` fails.
- A purpose is part of the version. Template versions are never updated, so
  choosing or changing a purpose means saving a new version, which writes a
  `config_version` row with author and diff (rule 10) and an audit event.
  Only members holding the module's template permission save one; in grants
  that is `grants.programmes.manage`.
- A module may restrict a template to one purpose. Grants' outcome and
  reminder templates are transactional only, and saving one as marketing is
  refused (S11-58).
- A marketing send also names one consent purpose from party's checked list,
  such as `future_funding`. The member who starts the send chooses it, and
  each of the send's module outbox rows records it. The sender takes the
  template's purpose from the version fixed on the row, never from the
  caller, so a marketing template cannot go out as transactional.

### What makes a message transactional

A message is transactional when the person needs it about something they
asked for or a relationship they are in, and it carries nothing that
promotes the funder's work or aims. Anything else is marketing, and a
service message with promotion added is marketing as a whole (GK).

In grants:

| Transactional                                              | Marketing                                                |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| Sign-up, sign-in and password reset emails                 | A new or reopened programme announced to past applicants |
| "We have received your application"                        | A newsletter or annual review                            |
| A reminder that the person's own draft closes on Friday    | An event invitation                                      |
| A request for more information about their application     | A fundraising appeal                                     |
| Their decision, once released                              | A decline email that adds "see our other programmes"     |
| Their grant agreement, payments and monitoring reports due |                                                          |

The template editor shows this rule beside the purpose, because the platform
cannot judge the wording; the member saving the version decides, and the
version records who did.

### The consent check

- Party publishes one server contract, the may-contact check: a person id, a
  channel, and either `transactional` or `marketing` with a consent purpose,
  to `allowed` or `not allowed` with a skip code from a closed list:
  `no_consent`, `consent_withdrawn`, `suppressed`, `person_erased` or
  `no_contact_point`. The tenant comes from the transaction.
- A **marketing** send passes only if the latest `party.consent` row for
  that person, purpose and channel is `given`, and no suppression applies
  (below). The check reads both in one query, through a view created
  `WITH (security_invoker = true)` so row-level security still applies.
- A **transactional** send never consults marketing consent. It is still
  refused for an erased person (ADR 0027), for a person with no address on
  the channel, and for a hard suppression: a `bounced` suppression on the
  address it would go to that no release names (below). Staff see the skip
  code on the module outbox row, so a skipped decision email is visible,
  not silent.
- The check runs in the send path only: in the sender, inside the tenant
  transaction that marks the outbox row, at the moment of sending. It runs
  again for every row, so a withdrawal between queuing and sending is
  honoured. A screen may show an estimate of who would be skipped, but only
  the send path decides.
- A refusal sends nothing and marks the module outbox row skipped with its
  code. Skip codes are a separate list from the sender's delivery failure
  codes, so a report can tell "not allowed" from "failed". An error in the
  check itself fails closed: nothing is sent and the row stays pending, to
  be retried like a delivery failure.
- The recipient's address is read through the party contract by the sender,
  never passed in by the caller, so a caller cannot check one person and
  mail another.

### Suppressions

`party.suppression` records that a person, or an address, must not be
contacted on a channel. Its shape:

- `tenant_id`, `id`, and `person_id`, a composite foreign key to
  `party.person (tenant_id, id)` `ON DELETE RESTRICT`;
- `channel`, checked against the same list as `party.consent`;
- `purpose`, one consent purpose, or null for every marketing purpose;
- `reason`, checked: `unsubscribed`, `bounced`, `complained`,
  `fps_request` or `staff_entry`;
- `source`, checked: `unsubscribe`, `staff` or `system`, with `provider`
  added by the first sending provider adapter;
- `address_hash`, the keyed hash of the address on the channel when the
  suppression was recorded, and `hash_key_version`; both null for `post`,
  since a person row holds no postal address;
- `recorded_at`, set by the database, and `recorded_by`, a membership,
  required exactly when the source is `staff`.

It is append-only. App roles hold `INSERT` and `SELECT` only, and `UPDATE`
and `DELETE` are denied with restrictive `false` policies.

**What each reason does:**

| Reason         | Recorded when                                         | Applies to                                 | Matches                              |
| -------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `unsubscribed` | The person unsubscribes from a message                | Marketing for the purpose                  | Person and address hash              |
| `complained`   | The person reports a message as spam                  | All marketing on the channel               | Person and address hash              |
| `fps_request`  | Staff record a Fundraising Preference Service request | All marketing on each channel it names     | Person, and address hash where known |
| `staff_entry`  | The person tells staff, by phone or letter            | The purpose, or all marketing              | Person, and address hash where known |
| `bounced`      | The mail server permanently refuses the address       | All mail on the channel, transactional too | Address hash only                    |

- A suppression applies to a send when it matches the person being mailed,
  or when its address hash equals the hash of the address the send would go
  to, whichever person that address now belongs to.
- **Bounces over SMTP.** With SMTP alone, a bounce is known only when the
  server refuses the recipient during the send. The platform talks to the
  operator's relay, which also refuses for its own reasons (relaying
  denied, a rate limit, a policy block), and those say nothing about the
  address. So a `bounced` suppression, with source `system`, is recorded
  only for a permanent reply about the recipient: a `5xx` reply to
  `RCPT TO` whose enhanced status code (RFC 3463) is `5.1.1`, `5.1.2`,
  `5.1.3` or `5.1.10`. Every other refusal records nothing: any `4xx`, any
  `5.7.x` or other policy reply, and a `5xx` without an enhanced status
  code. The row stays failed and is retried or reported like any delivery
  failure.
- **What the sender keeps.** Today `failureCode()` maps every refusal at
  `RCPT TO` to `recipient_refused`, whatever the reply class. S12-63 makes
  the sender keep the reply class and the enhanced status code, read from
  the SMTP client's numeric response code and the enhanced status code that
  follows it in the reply, matched against a fixed pattern. It discards the
  rest of the reply text as now. It answers a new code,
  `recipient_unknown`, for exactly the replies above, and
  `recipient_refused` for every other refusal at `RCPT TO`. Only
  `recipient_unknown` records a suppression. Unit tests cover `550 5.1.1`
  (recorded), `550 5.7.1`, `554 5.7.1`, `450 4.2.1`, `452 4.5.3` and a bare
  `550` (none recorded).
- A later bounce or complaint arrives only through a provider adapter
  (below).
- **Lifting.** No suppression is ever updated or deleted. A `bounced` one
  stops applying when the person's address changes, because it matches the
  old address only, or when a release names it (below). Every other reason
  stops applying, for its purpose and channel, only when the person later
  gives consent again themselves: a `given` row from their own signed-in
  portal session, or later from a self-service source such as a public
  form. A `given` row that staff record never lifts a suppression, so staff
  cannot override an objection.
- **Releasing a bounce.** A wrongly recorded bounce must not block a
  person's decision email for good. Staff holding `party.records.manage`,
  having confirmed the address with the person, record a row in
  `party.suppression_release`: `tenant_id`, `id`, `suppression_id`,
  `suppression_reason` with a `CHECK` that it is `bounced`, a composite
  foreign key `(tenant_id, suppression_id, suppression_reason)` to a unique
  `(tenant_id, id, reason)` on `party.suppression`, `reason` checked as
  `address_confirmed`, `recorded_by` (a membership, required) and
  `recorded_at` set by the database. The database thereby refuses a release
  of any other reason, so an objection can never be released this way. The
  table is append-only like `party.suppression`, and each release writes a
  `party.suppression.released` audit event in the same transaction. A
  release names one suppression, so a newer bounce on the same address
  applies again until it too is released.

### Suppressions after erasure

Decided: suppressions are the one record ADR 0027's erasure keeps, and they
keep only what they already hold: ids, codes, times and the keyed hash.
Nothing in a suppression is a plain personal value, so erasure leaves the
rows as they are.

- **Why a keyed hash.** After erasure the person's row reads
  `<party id>@erased.invalid` (ADR 0027), so a suppression matched by person
  alone protects only that row. The real risk is the same person arriving
  again as a new record, from an import or a new application. The keyed
  hash of the address catches that, and nothing else about them is kept.
- **The key.** One suppression secret per deployment, read through
  `readSecret` from a mounted secret, held outside the database and never
  in a database backup. Each tenant's key is derived from it with
  HKDF-SHA-256 and the tenant id, so the same address hashes differently in
  two tenants and the hashes cannot link a person across funders. Addresses
  are normalised before hashing: an email address trimmed and lower-cased,
  a phone number in E.164 form.
- **Versions.** A hash cannot be recomputed without the address, which
  erasure removed, so a key version is never retired while a row uses it.
  A new version only hashes new rows, and the check hashes the recipient's
  address under every version in use. The secret is escrowed with the
  platform key under ADR 0011 (being drafted). If a version the rows name is
  missing, every marketing send in the tenant fails closed.
- **Why keeping it is lawful.** The tenant keeps the hash to honour the
  person's objection to direct marketing, which UK GDPR Article 21(3) makes
  absolute and PECR regulation 22 backs for electronic mail; the
  Information Commissioner's direct marketing guidance tells organisations
  to keep a suppression list for this reason (GK). A keyed hash is
  pseudonymised personal data for the tenant, so the legal basis and the
  erasure exception it relies on go to the solicitor (S11-03).
- **How long.** For the life of the tenant, never under a tenant retention
  policy: an objection has no end date. Rows go only when the tenant is
  offboarded, or are superseded by the person's own consent as above. The
  classification entries mark `party.suppression` and
  `party.suppression_release`, which holds ids, codes and times only, as
  kept on erasure, with this ADR as the reason; they are the only such
  entries, and the schema lint fails on any other.
- **Agreement with ADR 0027.** The erasure engine's party contribution
  leaves `party.suppression` alone. ADR 0027's insert guard still refuses a
  new suppression naming an erased person, which is safe because an erased
  person is never mailed. Erasure records no suppression of its own: if the
  person also objects to marketing, staff record a `staff_entry` before the
  erasure runs.

### One-click unsubscribe

Every marketing message carries an RFC 8058 one-click unsubscribe. No
transactional message does.

**Headers.** `List-Unsubscribe: <https://…>` with exactly one HTTPS link and
no `mailto:`, and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The
sender builds both values itself, from a token that matches a fixed
character set and the tenant's portal address
([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md)), and accepts
no other extra header. No caller can pass a raw header, and every S02-16
rule stands: the address check, the refusal of CR, LF and every other
control character, plain UTF-8, the pinned host and port, the certificate
check and the time limits. Mailbox providers honour one-click only when a
DKIM signature covers both headers (RFC 8058 section 3) (GK); signing is
the operator's mail relay's job, and the self-hosting guide says so.

**Token.**

- AES-256-GCM under a key used for nothing else, derived with HKDF-SHA-256
  from the auth secret for the purpose `unsubscribe`, as
  [ADR 0010](0010-authentication-security-rules.md) derives every purpose
  key. A random 96-bit nonce; the format version and key version travel in
  clear as associated data.
- The plaintext holds ids and codes only: tenant id, person id, consent
  purpose, channel, the keyed hash of the address the message went to, and
  the issue date. Never an address, name or tenant slug. The whole token is
  base64url, under a fixed length cap.
- Valid for 24 months from issue, since a person may act on an old message
  and refusing them would leave no simple way out. A key version stays
  available for verification for 24 months after it stops issuing.
- Not single-use: a mail client may post it and the person may then click
  it, and a repeat does nothing new (below).

**Routes.** The link opens a page under the tenant's portal address.

- `GET` verifies the token and shows the tenant's name and look (through
  ADR 0019's public functions), the purpose's label and the channel, with a
  button that unsubscribes. It changes nothing.
- `POST` takes the token and the RFC 8058 body `List-Unsubscribe=One-Click`,
  or the same field from the page's form, and nothing else. It answers
  without a redirect.
- Both live in `apps/api/src/public/unsubscribe.ts`, set no tenant and
  never query a tenant table. The API verifies the token before it touches
  the database, then the `POST` calls one approved definer function,
  `party.record_unsubscribe(tenant_id, person_id, purpose, channel, address_hash, request_id)`,
  with the values from the verified token only (rule 6). As ADR 0019's
  public functions do, it has its own `NOLOGIN` owner
  ([ADR 0023](0023-function-owner-memberships.md)), a pinned
  `search_path`, every name qualified, `EXECUTE` for `app_api` only, a
  catalogue entry with exactly the grants it needs
  ([ADR 0003](0003-query-builder-and-migrations.md#approved-definer-functions)),
  and a fixed result code.
- **Who may call it.** The function writes into the tenant its argument
  names, and every `app_api` connection can execute it, so row-level
  security does not confine it. Two guards do:
  - a Semgrep rule bans calling `party.record_unsubscribe` anywhere except
    `apps/api/src/public/unsubscribe.ts` and the database tests, as
    ADR 0003 does for `auth.sso_providers_by_key_version()` and ADR 0019
    for `app.create_tenant()`. The rule's own test holds a call in another
    file and fails if Semgrep passes it;
  - the function refuses, writing nothing, when `app.current_tenant_id()`
    is set, so it cannot run inside a signed-in or job transaction, where a
    bug or an injection would otherwise turn it on another tenant. A
    database test calls it with a tenant set, as `app_api`, and proves it
    refuses and writes nothing in either tenant.
- **Tenant source.** ADR 0003 says a tenant id never comes from a caller
  argument unless it is one of its listed sources. Its list gains one, in
  this route only: the tenant inside an unsubscribe token that the API has
  verified. It is never set as `app.tenant_id`; it is passed only as this
  function's argument, which checks the tenant is active and holds the
  person.
- The function refuses, writing nothing, when the tenant is unknown or not
  active, the person is not in that tenant or is erased, or a code is
  outside its list. Otherwise it records exactly one unsubscribe for that
  person, purpose and channel: a `withdrawn` consent row with source
  `unsubscribe` and an `unsubscribed` suppression with the token's address
  hash, with `party.consent.recorded` and `party.suppression.added` audit
  events, actor kind `system`, the request id and the person as subject
  (ADR 0027), all in one transaction. If the latest consent row is already
  `withdrawn` and a matching suppression exists, it writes nothing and
  answers "already unsubscribed".
- Every failure, whether a malformed, tampered, expired or unknown-version
  token, an unknown tenant or an erased person, gets the same page and the
  same problem, which never echoes the token
  ([ADR 0004](0004-api-contract.md)).
- Responses send `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`, and the token is redacted from logs and
  traces.
- Both routes sit under the public rate limits (S11-36), per client
  address, checked before the token is verified. Unusual unsubscribe volume
  in a tenant raises an alert rather than a refusal, since refusing would
  stop people opting out.

**Threats.** The unsubscribe `POST` is the first unauthenticated route that
changes a person's record. S12-54 writes the full threat model from these:

| Threat                                  | Answer                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged token                            | Authenticated encryption under a key outside the database; a token cannot be made or changed without it                                                                                                 |
| Token naming a person in another tenant | The tenant is inside the encrypted token and cannot be altered; the function writes only in that tenant, and refuses a person not in it; a token whose tenant differs from the page's tenant is refused |
| Replay                                  | A repeat records nothing new, so replay gains nothing beyond the original click                                                                                                                         |
| Enumeration                             | No valid token can be guessed; every failure looks the same; rate limits per client                                                                                                                     |
| Mail scanners that follow links         | `GET` changes nothing; only a `POST` with the one-click body changes anything                                                                                                                           |
| A forwarded message                     | Whoever holds it can unsubscribe the original recipient from that purpose and channel. Accepted: the harm is small, and the person can give consent again                                               |
| Token leak through logs or referrers    | Redaction, `no-store` and `no-referrer`                                                                                                                                                                 |
| Leak of the purpose key                 | Lets someone unsubscribe people whose ids they know. The key is rotated, and tokens under the old version stop verifying                                                                                |
| Another route calls the function        | A Semgrep rule admits only the unsubscribe route's file; the function refuses whenever a tenant is set, so no signed-in or job transaction can reach another tenant through it                          |

### Soft opt-in

- The soft opt-in is a consent source, `soft_opt_in`, on a `given` row, so
  the check treats it like any consent and the person withdraws it the same
  way. It may be recorded only when all three conditions hold (PECR
  regulation 22(3), GK):
  - the address was collected from the person in an existing relationship
    (for a company, in the course of a sale or negotiations for one);
  - the marketing is about the tenant's own similar services, which the
    consent purpose states;
  - the person was given a simple way to refuse when their details were
    collected, and is given one in every message, which one-click
    unsubscribe provides.
- The collecting form or screen shows the refusal and records which notice
  version it showed. Staff may not record a soft opt-in after the fact.
- The Data (Use and Access) Act 2025 extends the soft opt-in to charities,
  for people who have expressed an interest in or support for the charity's
  purposes (GK, including when it comes into force). Whether a funder's
  applicants fall within it, and which purposes count as similar, go to the
  solicitor (S11-03).
- Until that advice, no consent purpose is marked as open to the soft
  opt-in, so the source cannot be recorded. Marking one is a migration that
  widens the check, made only after the advice.

### Fundraising Preference Service

A request from the Fundraising Preference Service becomes one suppression
per channel it names, with reason `fps_request`, purpose null and source
`staff` (GK: such requests must be met within 28 days). Nothing more is
built now: `fundraising` (wave 4) uses this when it arrives, and may add an
import of the service's notifications as another source.

### Changing consent

- **Signed in:** portal preferences show the current state for each purpose
  and channel and let the person change one. They use permission
  `party.profile.manage` with scope `own_person`, the person comes from the
  session, never from the request (rule 6), and each change records one
  `party.consent` row with source `portal` and a `party.consent.recorded`
  audit event.
- **Not signed in:** only the one-click unsubscribe above.
- **Staff** record consent or a suppression on a person's behalf, for
  example from a paper form or a phone call, with source `staff` and
  themselves as `recorded_by`. Their `given` row never lifts a suppression.
- ADR 0036 (anonymous public submissions, being drafted) decides how a
  public form records consent. It records it through the same party
  contract.

### Senders, providers and outboxes

- SMTP stays the baseline sender (rule 1). Provider APIs, with their bounce
  and complaint webhooks, are optional adapters behind the same sender
  interface, added by a later ADR or as plugins under ADR 0044 (plugin API,
  being drafted). An adapter records bounces and complaints as suppressions
  with source `provider`; its inbound webhook is a public route that the
  adapter's ADR secures.
- Module outboxes stay as ADR 0020 set them: each module that sends keeps
  its own, with real foreign keys to the person and the record the message
  is about. The consent check sits between the outbox and the sender:
  module outbox row, then the may-contact check, then the sender, which
  marks the row sent, failed or skipped.
- `sendChecked()` in `apps/api/src/email/` sends every module outbox
  message, transactional and marketing. It runs the may-contact check for
  the template's purpose, sends, and records a `bounced` suppression on
  `recipient_unknown`. Module code is handed only `sendChecked()`, never the
  raw sender.
- `send()` stays as S02-16 built it, for auth emails only: sign-up, sign-in,
  invitations, MFA codes and password reset. They belong to an account, not
  a party person, and are often sent before any tenant is known, so they
  take no party check and never record a suppression, whatever the reply.
  A test proves an auth email refused with `550 5.1.1` writes nothing.
- The event outbox of [ADR 0034](0034-event-outbox.md) is not a mail queue.
  Nothing sends mail from it.

### For the solicitor (S11-03)

1. The PECR regulation 22 test for marketing, and the line between
   transactional and marketing messages for a funder's applicants (GK).
2. The soft opt-in after the Data (Use and Access) Act 2025: when the
   charity extension applies, whether applicants count, and what "similar"
   means for a funder (GK).
3. The legal basis for keeping a keyed hash of an erased person's address,
   and for how long (GK).
4. The Fundraising Preference Service's 28-day period and whether a later
   consent from the person lifts its suppression (GK).
5. Whether a 24-month token lifetime is acceptable, or a link must work
   for the life of the message (GK).

### Not decided here

- Sending provider adapters, inbound bounce handling and per-tenant SMTP
  settings.
- SMS and phone sending: no sender exists, and calls bring the Telephone
  Preference Service, which a later ADR covers.
- `engage` audiences, sends and their screens.

## Consequences

- Rule 1: SMTP is the only sender the platform needs; hashing and the token
  use `node:crypto` only.
- Rule 2: `party.suppression` is a tenant table set up with
  `app.enable_tenant_rls()`, with a cross-tenant denial test. Tests also
  prove that a token minted in one tenant records nothing in another, that
  the definer function writes only in the token's tenant and refuses when a
  tenant is set, and that the current-consent view returns nothing across
  tenants or with no tenant set. `party.suppression_release` has its own
  cross-tenant denial test, and a test that a release naming another
  tenant's suppression is refused.
- Rule 3: template purpose (with no default), suppression channel,
  purpose, reason and source, release reason, and consent source are
  `CHECK`ed lists; suppressions reference `party.person` and
  `app.membership` by composite foreign key, and a release references a
  `bounced` suppression by composite foreign key. Tests prove that a
  template version without `purpose` and a release of a non-`bounced`
  suppression are both refused.
- Rule 4: every consent change, suppression, release and unsubscribe writes
  an audit event with ids and codes only, in the same transaction as its
  row. A skipped send is recorded on its module outbox row, with its code.
- Rule 5: every new column is classified with a retention rule:
  `address_hash` personal and the other suppression and release columns
  personal or internal, all kept for the life of the tenant and on erasure;
  template `purpose` internal, with its version's retention.
- Rule 6: on a signed-in preference change the person comes from the
  session; on an unsubscribe, from the verified token, never from the
  request body.
- Rule 9: no code path sends marketing because consent exists. Giving
  consent sends nothing, there are no automated marketing journeys, and a
  named member starts every marketing send.
- Rule 10: a template's purpose changes only by a new version, with its
  configuration version.
- New contracts entry points that build on this ADR, such as S11-44's party
  additions, import the jitless zod switch (`packages/domain/src/jitless`)
  first and are covered by the jitless test.
- Build order: party contracts (S11-44) and the grants template purpose
  (S11-58); the suppression table, purpose column and unsubscribe function
  (S12-53); consent-checked sending and the headers (S12-63); the
  unsubscribe and preference routes (S12-71) and screens (S12-80).
- Costs we accept: a suppression secret that must be escrowed and whose
  versions never retire; a hash of the recipient's address under each
  version on every send; and a public route that writes, with its own
  threat model and rate limits.
- This ADR amends ADR 0003 (`party.record_unsubscribe` joins its approved
  definer functions, with a Semgrep rule limiting its caller, and its tenant
  sources gain the verified unsubscribe token in the unsubscribe route
  only), ADR 0017 (the suppression and release tables, and the consent
  sources `unsubscribe` and `soft_opt_in`), ADR 0020 (skip codes on module
  outbox rows, and the check before sending) and ADR 0027 (it settles the
  form of suppressions kept on erasure). Their status lines change in a
  later housekeeping change.

## Dependency check

No dependency is added. AES-256-GCM, HKDF-SHA-256 and HMAC-SHA-256 come from
`node:crypto`.
