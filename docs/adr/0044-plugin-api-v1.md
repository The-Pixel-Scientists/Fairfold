# ADR 0044: Plugin API v1 and the section 7 permission

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Aaron Gardner

## Context

Funders and partners need to connect Fairfold to their own systems:
ledgers, e-signature providers, registries, reporting tools and their own
scripts. `connect` builds the plugin API for wave 2 (June 2027).
[V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1) keeps integrations out of V1,
so this ADR adds no V1 work. It settles how plugins reach the product and
the licence terms their authors rely on, because that text must be public
before the first outside contribution.

What this builds on:

- **Licence.** [ADR 0002](0002-licence-and-dependency-policy.md): the code
  is AGPL-3.0-or-later; the plugin API takes option 5, "MIT SDK plus an
  additional permission under AGPL section 7", drafted with a solicitor;
  the SDK package is MIT with its own `LICENSE` and depends only on
  permissive code. "The section 7 plugin permission only covers code whose
  authors granted it", so the text is published before outside
  contributions arrive.
- **The API.** [ADR 0004](0004-api-contract.md): route contracts in
  `packages/domain`, each with a permission and a scope rule; an OpenAPI
  document generated from them and committed as `apps/api/openapi.json`;
  problem details; responses built through the audience projection.
- **Modules.** [ADR 0016](0016-modular-suite-and-shared-warehouse.md):
  modules talk through published contracts.
  [ADR 0024](0024-no-tool-on-by-default.md): a tool that is off answers 404.
- **Events.** [ADR 0034](0034-event-outbox.md): ids-only payloads, a
  per-tenant sequence, and the webhook envelope, signing scheme, delivery
  rules and retries that `connect` uses. It leaves subscriptions, their
  permissions and the disabling of failing endpoints to `connect`.
- **Outbound calls and secrets.**
  [ADR 0010](0010-authentication-security-rules.md): one dispatcher for
  outbound HTTP that refuses private addresses, and stored secrets
  encrypted with a key version.
- **Limits and keys.** [ADR 0028](0028-idempotency-keys.md): idempotency
  keys on create routes and the `app.request_limit` buckets.
- **What needs a plugin.** Commercial e-signature providers
  ([ADR 0040](0040-esignature-and-document-generation.md)) and further
  ledgers ([ADR 0041](0041-money-and-the-finance-boundary.md)) are offered
  only as plugins under this ADR. The suite will never run third-party
  plugins inside the managed service's own process.

Licence points below rest on general knowledge where marked (GK) and are
for the solicitor.

## Options considered

How plugins reach the product:

1. **In-process plugins**, loaded into the API or worker. The most power,
   but third-party code would run with our database roles and secrets, in
   every tenant's process. Refused for the managed service.
2. **Out of process only: the REST API and signed webhooks.** A plugin is
   just another client. Everything it does passes the same policy,
   row-level security, projection and audit as a person's request.
3. **Out of process, plus a sandboxed script runtime** inside the product.
   A new runtime to secure and keep up to date, for little that option 2
   cannot do.

How a plugin authenticates:

4. **Long-lived API keys.** Simple, but a leaked key works until someone
   notices.
5. **OAuth 2.1 client credentials**, exchanged for short-lived access
   tokens. A leaked token expires quickly, and the same token service
   serves ADR 0048 (MCP access, drafted with this one).

The licence:

6. **MIT SDK alone.** Clear for the SDK, but leaves plugin authors to judge
   for themselves how far the AGPL reaches (ADR 0002, option 4).
7. **MIT SDK plus an additional permission under section 7,** stating that
   a plugin which uses only the published interfaces is not covered by the
   AGPL. Removes the doubt for authors and for funders who commission
   private plugins.

## Decision

Options 2, 5 and 7.

### Out of process only

- A plugin is a program its owner runs on their own infrastructure. It
  reaches Fairfold only through the REST API generated from the published
  contracts (ADR 0004) and receives only signed webhooks (ADR 0034).
- The managed service runs no third-party code in its own process, and
  hosts no plugins in v1. Hosting reviewed plugins is a question for the
  2028 marketplace.
- No plugin route, hook or extension point exists inside the API, worker,
  console or portal. A self-hoster who changes the code itself is
  modifying the program, under the AGPL, including section 13.

### API clients

- An API client belongs to one tenant, in one cell. A tenant
  administrator creates it in the console with a `connect` permission and
  step-up, and chooses its permissions from the existing catalogue.
- **The catalogue mark is the control.** A client holds only permissions
  that the permission catalogue marks as **grantable to a client**. The
  mark is off unless a permission's entry sets it, and the console offers
  only marked permissions when an administrator sets up a client.
- **The rule-9 set is never marked.** The domain package keeps a named set
  of permissions that award, reject, release, pay, decide or change access
  (rule 9): `grants.decisions.record`, `grants.decisions.release`,
  `platform.approvals.decide`, `platform.members.manage`,
  `platform.teams.manage`, `platform.erasure.request`,
  `privacy.requests.erase`, `platform.break_glass.use` and
  `assure.screening.decide`, and `finance`'s payment and bank details
  permissions when it adds them. A permission that does any of these joins
  the set in the change that adds it. A unit test fails if any permission
  in the set is marked, and if any permission that needs step-up is
  marked.
- Step-up is a second guard where a permission has it: a client cannot
  step up, so such a route refuses it even if mismarked. Not every rule-9
  permission has step-up (`grants.decisions.record` has none), so the mark
  and its test, not step-up, keep a client from recording an outcome.
- Reviewer and applicant permissions are never grantable.
- A client has no access rows ([ADR 0037](0037-record-level-permissions.md)),
  so it reaches only records that are not restricted, and never through
  break-glass.
- The client's credentials are a client id and a secret of 32 random
  bytes, shown once and stored as a SHA-256 hash. The token route exchanges
  them for an opaque access token valid for 15 minutes, stored as a hash,
  whose audience is that cell's API. Secrets expire after at most 12 months
  and rotate with an overlap; a tenant administrator can revoke a client at
  once.
- Each request sets the client's tenant in the transaction, as a session
  does, and runs as the API's own role, which never has `BYPASSRLS`. Every
  row-level security policy applies.
- Responses use the staff audience projection, narrowed to the client's
  permissions and to a classification ceiling: `internal` by default,
  `personal` only if the administrator allows it for that client, and
  never `special_category`. Aggregate-only data stays aggregate
  ([ADR 0032](0032-equality-and-monitoring-data.md)), and decision fields
  stay private until release (rule 8).
- Every action a client takes is audited with the client as the actor, in
  a new actor kind beside members and the system. The administrator who
  created it is recorded on the client, not as the actor.
- Each client has its own rate limit bucket in `app.request_limit`, and
  create routes take idempotency keys as for any caller (ADR 0028). A
  module that is off answers 404 to a client too.

### Webhooks

- A subscription belongs to one API client and names the event types it
  receives. An event type is delivered only while the client holds that
  event's read permission, checked when the subscription is made and at
  every delivery, as ADR 0034 requires.
- **No events about restricted records.** An event about a restrictable
  record names that record type in its `defineEvent`, as the record's
  routes name `record:` (ADR 0037). Such an event is delivered only if, at
  delivery, the record is reachable without access rows: it is not
  restricted. Otherwise the delivery is skipped and the delivery log
  records the code `record_unreachable`, so a client never learns the id,
  type or timing of a restricted record's events.
- Each delivery is ADR 0034's envelope: the event id, type, sequence,
  occurrence time and the ids-only payload. Receivers read current values
  through the API with their own permissions.
- **Signing.** HMAC-SHA-256 with a random 32-byte secret per subscription,
  over the event id, a timestamp and the raw body, in the `webhook-id`,
  `webhook-timestamp` and `webhook-signature` headers (ADR 0034). Receivers
  refuse a timestamp more than 5 minutes from their clock and a repeated
  event id, so a replay fails. The secret is shown once, stored encrypted
  with a key version as ADR 0010 stores SSO secrets, and rotated with an
  overlap during which both signatures are sent.
- **Nothing leaks through the address or headers.** The event never
  appears in the URL. Requests carry only the three signature headers and
  the content type: no tenant name, slug, user or record value. A
  subscription URL must be HTTPS and may not contain a user name or
  password. It is shown only to administrators, and logs record its host
  alone.
- **Delivery** goes through the dispatcher (ADR 0010), which resolves the
  host at each attempt and refuses private, loopback, link-local and
  metadata addresses. There is no exception for self-hosted receivers on a
  private network. A `2xx` within 10 seconds is success; redirects are not
  followed; the response body is discarded.
- **Retries** follow ADR 0034's eight attempts over about 45 hours. A
  subscription whose deliveries have all failed for 3 days is disabled,
  its administrators are told, and an administrator can turn it back on and
  re-send events still within the outbox's 90 days.
- **The delivery log** holds, per attempt: the subscription, the event id,
  the attempt number, the HTTP status code, the duration and an error code.
  It never holds a request or response body or header. Every column is
  classified `internal`; rows are kept 30 days. It holds no personal data,
  so erasure ([ADR 0027](0027-erasure-across-modules-and-audit.md)) changes
  nothing in it.

### Tests `connect` ships with

- A cross-tenant denial test for each client, subscription and delivery
  log table (rule 2).
- The catalogue test above: no permission in the rule-9 set, and none that
  needs step-up, is grantable to a client.
- A cross-reach denial test: a client reading a restricted record gets 404,
  and a client subscribed to a restrictable record's events receives no
  delivery for a restricted record, while the delivery log holds
  `record_unreachable`.
- A test that a client's token is refused by another tenant and another
  cell.

### The SDK

- One SDK package, published under the `@pixel-scientists` scope, holds a
  typed client for the OpenAPI document and a webhook signature verifier.
- It is MIT, with its own `LICENSE` file, and depends only on permissive
  code: MIT, ISC, BSD or Apache-2.0. `licence-policy.json` gains a stricter
  list for the SDK's own dependency tree, and `pnpm check:licences` fails if
  anything else reaches it.
- It imports nothing from the AGPL workspace packages. Its client is made
  from the published OpenAPI document; whether that output can carry the
  MIT licence is one of the questions for the solicitor below.

### The section 7 additional permission

The text below is **a draft for the solicitor**, not a licence. It follows
the usual structure of published section 7 exceptions (definitions, the
permission, its limits), such as Twenty's application exception, the
precedent ADR 0002 names (GK). Aaron publishes the final text in `NOTICE` by January
2027, before the first outside contribution. Code contributed before the
text is published is not covered unless its author grants the permission.

> **Additional permission under section 7 of the GNU Affero General Public
> License, version 3**
>
> 1. **Definitions.** "The Program" means the Fairfold software published
>    by its copyright holders under the GNU Affero General Public License,
>    version 3 or any later version. "Published Interfaces" means: (a) the
>    HTTP API described in the OpenAPI document published with a release of
>    the Program; (b) the webhook messages the Program sends, as described
>    in that release's documentation; and (c) the software development kit
>    the copyright holders publish under the MIT licence. A "Plugin" is a
>    work that runs in a separate process from the Program and communicates
>    with it only through the Published Interfaces, and that contains no
>    part of the Program other than the software development kit.
> 2. **Permission.** As an additional permission under section 7, the
>    copyright holders of the Program give you permission to make, use,
>    modify, convey and make available over a network any Plugin under terms
>    of your choice, and to use and convey the Program together with any
>    Plugin, without the Plugin becoming subject to the GNU Affero General
>    Public License.
> 3. **Limits.** This permission does not cover the Program itself or any
>    modified version of it, which remain under the GNU Affero General
>    Public License, including section 13. It grants no right to any trade
>    mark of the copyright holders.
> 4. **Your versions.** If you modify the Program, you may extend this
>    permission to your version, but you are not obliged to. If you do not,
>    remove it from your version.
> 5. **Who gives it.** Each copyright holder gives this permission for the
>    code it holds copyright in that is published with this notice.

What goes with it:

- `CONTRIBUTING.md` says that contributions are made under the AGPL with
  this permission, once published. Aaron edits both files.
- NOTICE names the date from which the permission applies.

### Later

- **Plugin signing:** plugins listed by the project are signed, and their
  provenance recorded, before the 2028 marketplace.
- **The marketplace** (2028): reviewed, signed plugins, and whether the
  managed service ever hosts any, in its own ADR.
- **Sub-processors:** a plugin that receives a tenant's data is a separate
  processor. The funder that connects it is responsible for it, and any
  plugin the service company offers or hosts has its sub-processors
  disclosed in the DPAs.

### Questions for the solicitor

1. Is the permission needed at all for plugins that talk only over HTTP,
   or does it only remove doubt? Either way, is the wording safe to
   publish?
2. Is "communicates only through the Published Interfaces" clear and
   enforceable, and does it cover a plugin that also reads a funder's
   warehouse copy?
3. Can the OpenAPI document and a client generated from it be licensed
   under MIT, when they are produced from AGPL code?
4. Does the permission hold for later versions of the AGPL under the "or
   later" clause, and for versions of the Program released before it was
   published?
5. Is DCO sign-off enough for contributors to grant the permission, or does
   `CONTRIBUTING.md` need explicit words, and do contributors who signed
   off before the text was published need to grant it again?
6. Should the permission sit in `NOTICE`, in each file's header, or both?
7. Does anything change under the law of England and Wales, or for EU
   users in a later EU cell?

## Consequences

- Rule 1: plugins are ordinary HTTPS clients and receivers, so they run
  anywhere.
- Rule 2: clients, subscriptions and delivery logs have `tenant_id`,
  row-level security and a cross-tenant denial test, and a client's token
  works in its own tenant and cell only.
- Rule 4: every client action is audited with the client as the actor,
  and every subscription and client change is audited.
- Rule 5: client, subscription and delivery log columns are classified,
  with the retention above.
- Rule 9: no permission a client can hold awards, rejects, releases, pays
  or records an outcome, because the rule-9 set is never grantable and a
  test keeps it so.
- A plugin can do only what the API offers. Funders who need more ask for
  a route, which keeps bespoke requests out of forks.
- The permission catalogue gains a "grantable to a client" mark and the
  rule-9 set with its test, `defineEvent` gains the record type for events
  about restrictable records, the audit actor gains a client kind, and the
  SDK needs its own licence list. All arrive with `connect` in wave 2.
- The section 7 text must reach the solicitor in December 2026 so that
  Aaron can publish it in January.

## Dependency check

No dependency is added. The SDK's own dependencies, if any, are checked
under ADR 0002 when `connect` builds it, against the stricter permissive
list above. The SDK itself is ours, under MIT.

| Package | Licence | Status                              | Notes                                              |
| ------- | ------- | ----------------------------------- | -------------------------------------------------- |
| The SDK | MIT     | Ours; built in wave 2, not yet made | Its own `LICENSE`; depends only on permissive code |
