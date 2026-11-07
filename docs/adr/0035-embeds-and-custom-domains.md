# ADR 0035: Embeds, custom domains and browsing before sign-in

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Everything so far assumes a visitor who signs in. Three things in the next
two waves do not:

- `forms` v1 (March 2027) puts anonymous public forms on funders' own
  websites, embedded from a separate origin, with no non-essential cookies.
  [ADR 0036](0036-anonymous-public-submissions.md) decides how such a form
  is submitted; this ADR decides where it is served and who may frame it.
- [E6](../V1-PLAN.md#e6-applicant-portal) asks that applicants "browse open
  programmes, see eligibility, dates and award ranges before starting".
  MVP1 cut that to after sign-in.
- The eligibility widget and the charity and company lookup widget
  (Q1 2027) are small pages that funders place on their own sites.

What already holds:

- [ADR 0006](0006-design-system.md) gives the console and portal
  `frame-ancestors 'none'`, `default-src 'self'`, `script-src 'self'`,
  `form-action 'self'`, a per-response style nonce and a fixed set of
  security headers. Nothing can frame either app, and that must not change:
  both hold sessions.
- [ADR 0022](0022-serving-the-web-apps.md) serves each app from
  `scripts/web-server.ts` with a fresh 128-bit nonce on every `index.html`.
  [ADR 0030](0030-files-and-reverse-proxy.md) puts nginx in front in the
  self-hosted stack, and Google Cloud's external Application Load Balancer
  in front of the managed service, configured only under `infra/terraform/`
  ([rule 1](../ARCHITECTURE.md)). TLS ends there.
- [ADR 0010](0010-authentication-security-rules.md): session cookies use
  the `__Host-` prefix (host-only, no `Domain` attribute) and are Secure,
  HttpOnly and `SameSite=Lax`. The API resolves the app from the request
  host, checked against the configured hosts, and every request other than
  `GET` or `HEAD` must carry the `Origin` of the app its host resolved to.
- [ADR 0019](0019-tenant-addresses-public-pages-and-theming.md) chose
  approved definer functions that return only public columns for reads
  before sign-in, so that no anonymous request ever runs with a tenant set.
  It says that a custom domain per tenant, and browsing programmes before
  sign-in, would each extend it. This ADR is that extension.
- [ADR 0003](0003-query-builder-and-migrations.md) lists the approved
  definer functions and the tenant sources; the catalogue test checks both.
- [ADR 0016](0016-modular-suite-and-shared-warehouse.md) and
  [ADR 0024](0024-no-tool-on-by-default.md): a module is on for a tenant
  only when an `app.tenant_module` row says so. Definer functions run
  outside the policy module, so they check the switch themselves.

## Options considered

Where embeddable pages are served:

1. **From the portal, with `frame-ancestors` relaxed per tenant.** No new
   host, but the portal holds applicant sessions, so every signed-in page
   could be framed by a listed site and clickjacked, and one host would need
   a policy per tenant.
2. **From a subdomain of the same site** (`embed.example.org` beside
   `portal.example.org`). One certificate and DNS zone, but the browser
   treats the two as the same site: requests from the embed to the portal
   count as same-site, so even `SameSite=Strict` cookies go with them, and
   the embed host can set cookies for the parent domain that the portal
   then receives.
3. **From a separate site** (its own registrable domain). The browser keeps
   it apart from the console and portal by every cookie and same-site rule.
   Costs a second domain and certificate.

Who may frame an embed:

4. **Anyone** (`frame-ancestors *`). Simplest for funders, and an open door
   to clickjacking a public form from any page.
5. **Each tenant's list of origins, with wildcards.** Short lists, but
   `https://*.example.org` admits every subdomain, including ones on shared
   hosting that the funder does not control.
6. **Each tenant's list of exact origins, capped.** A funder has a few
   sites; listing each one is cheap.

Which layer sets the framing header:

7. **The reverse proxy**, looking the list up per request. Two proxies to
   keep in step (nginx and the load balancer), neither of which can call
   the API cheaply.
8. **The web server in an embed mode**, which already sets the policy and
   the nonce and has unit tests.

Custom domains:

9. **Now**, for the console, portal and embed.
10. **Deferred**, with the conditions to revisit written down.

## Decision

Options 3, 6, 8 and 10, and programme browsing through one more approved
definer function in ADR 0019's pattern.

### The embed origin

- Embeddable pages are served only from a separate embed host. The console
  and portal never serve one, and keep ADR 0006's policy, including
  `frame-ancestors 'none'`, unchanged.
- The embed host is a separate site from the console and portal hosts. The
  managed service uses a registrable domain of its own for it. A
  self-hosted install should do the same: at start-up the API refuses an
  embed host that is the same as an app host, or sits inside or beside one
  under the same parent domain, which catches the usual same-site layouts
  without a public suffix list. The self-hosting hardening guide explains
  why.
- Embeds are off unless an embed host is configured. A single-host install
  can still configure one, as a second host.
- The embed host serves an embed build of the portal from the same web image
  as the portal, through `scripts/web-server.ts` in an embed mode (S12-75).
  Paths start with the tenant's slug, such as `/northfield/forms/{form id}`.
  The slug in the path is the only thing that selects a tenant, never a
  header or query value.
- Only anonymous pages are embeddable: public forms
  ([ADR 0036](0036-anonymous-public-submissions.md)) now, and the two
  widgets below later. A form for signed-in respondents opens the portal in
  a new tab. Session cookies are never loosened (`SameSite=None`, a
  `Domain` attribute) to make a signed-in page work in a frame.

How session cookies never reach it:

- Console and portal cookies are `__Host-` cookies, so the browser sends them
  only to the exact host that set them, never to the embed host. Because the
  embed host is a separate site, a request from an embed page to the
  console or portal is cross-site, so `SameSite=Lax` keeps those cookies
  off it, and the embed host cannot set a cookie that either app receives.
- The embed host has no auth routes. The API resolves it as the embed host,
  which reaches public routes only, never reads a session, and accepts as
  `Origin` only the embed origin itself.
- On the embed host the proxy removes every `Cookie` request header and
  every `Set-Cookie` response header. This amends ADR 0030's rule that the
  proxy never changes a header, for the embed host only. It matters if a
  funder's own cookies were ever sent to a host under their domain (see
  custom domains).

What the embed host forwards:

- `/api/public/tenants/{slug}/…` routes the embed needs go to the API: the
  tenant's name, theme and logo (ADR 0019) and the public form routes
  ([ADR 0036](0036-anonymous-public-submissions.md)). Each later user adds
  its own paths to that list. Everything else under `/api/` gets 404 from
  the proxy, so console, portal, auth and probe routes are never reachable
  there.
- Everything else goes to the web server in embed mode.
- The proxy's rate limits apply as on the other hosts.

### Its content security policy

The embed host's policy, on every response it sends:

```
default-src 'self';
script-src 'self';
style-src 'self' 'nonce-{nonce}';
img-src 'self';
font-src 'self';
connect-src https://{embed host}/api/public/tenants/;
worker-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'self';
frame-ancestors {the tenant's origins, or 'none'}
```

- Scripts: `script-src 'self'` with no inline script and no `eval`, as in
  ADR 0006. The embed host serves only our build from memory and API
  answers that are JSON or images sent with `nosniff`, so `'self'` admits
  our own files and nothing else. A script nonce would add nothing on a
  page that allows no inline script.
- ADR 0022's nonce rule applies unchanged: each `index.html` gets a fresh
  128-bit nonce from `node:crypto`, used in `style-src` only and never
  cached.
- `connect-src` names only the API's public tenant routes on the embed
  origin itself. No storage origin is added: public forms take no files in
  v1 ([ADR 0036](0036-anonymous-public-submissions.md)), and storage has no
  edge (ADR 0030).
- `worker-src 'self'` is for the proof-of-work check, which runs in a Web
  Worker ([ADR 0036](0036-anonymous-public-submissions.md)).
- The other ADR 0006 headers are sent as on the apps: HSTS, `nosniff`,
  `Referrer-Policy: same-origin`, the same `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin`, and `Cache-Control: no-store`
  on `index.html`.
- `X-Frame-Options` is not sent. It cannot list origins (`ALLOW-FROM` is
  ignored by current browsers), and `DENY` beside an allow list would
  contradict it. Every browser the portal supports (ADR 0006) obeys
  `frame-ancestors`. A browser too old for it could frame an embed from any
  site; the clickjacking rule below is the guard in that case.
- An embed page tells its parent page only its content height, so the
  parent can size the frame, and listens to no message from the parent.

Clickjacking: an embed page always shows the tenant's name, never acts on
load, and submits only on an explicit button press ("Submit response").

### Per-tenant `frame-ancestors`

- Each tenant lists the origins allowed to frame its embeds, in
  `app.embed_origin`: `tenant_id`, `id`, `origin`, `created_by` and
  `created_at`, unique per tenant and origin, at most 20 rows per tenant.
- An origin is `https://host` or `https://host:port`: lower-case host, no
  path, query, fragment, user information, wildcard or IP literal, and
  length-capped. `embedOriginSchema` in `packages/domain` checks it in the
  browser and again on the server; the table's `CHECK` repeats the pattern.
- No wildcard of any kind, for the reason under option 5. A funder with
  many sites lists them, up to the cap.
- Changing the list needs `platform.settings.manage`, writes a
  `config_version` of type `platform.embed_origins` with author and diff
  ([rule 10](../ARCHITECTURE.md)), and writes an audit event,
  `platform.embed_origin.added` or `platform.embed_origin.removed`
  ([rule 4](../ARCHITECTURE.md)), in one transaction.
- An empty list means embeds are refused, not open.

Reading the list with no tenant set joins ADR 0003's approved definer
functions:

| Function                  | Callable by | Returns                                                                                                                                       | Its owner holds                                                                                                                                                                                                                         |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.embed_origins(slug)` | `app_api`   | For an active tenant with a module that offers embeds switched on (in v1, `forms`): its allowed origins; nothing otherwise, never a tenant id | `SELECT` on `id`, `slug` and `status` of `app.tenant`; on `tenant_id`, `module` and `enabled` of `app.tenant_module`; and on `tenant_id` and `origin` of `app.embed_origin`; each with a `SELECT` policy `TO` it that is `USING (true)` |

- Its owner is `owner_app_embed_origins`, `NOLOGIN`, with
  `search_path = pg_catalog, pg_temp`. It sets no tenant and adds no tenant
  source: like ADR 0019's functions, it resolves the tenant inside itself.
- `GET /public/tenants/{slug}/embed-origins` returns the list through it,
  with the one 404 of ADR 0019 for an unknown, suspended or switched-off
  tenant.

How the header is set:

- The web server in embed mode decides `frame-ancestors`, and nothing else
  adds or changes it. It reads the list from that public route over the
  internal network, keeps it in memory for at most 60 seconds per slug, and
  so a removed origin stops being allowed within a minute.
- Every origin is checked again before it is written into the header, so a
  stored value can never add a directive.
- It fails closed: an unknown, suspended or switched-off tenant, an empty
  list, a lookup error or a lookup slower than 2 seconds gives
  `frame-ancestors 'none'`.
- The policy depends only on the path, and `index.html` is never cached, so
  no shared cache can serve one tenant's policy for another's page.

### No non-essential cookies

- The embed origin sets no cookie, and the proxy removes any that reaches
  it. Nothing is kept in the browser's storage unless the page says so
  beside the control that keeps it. In v1 nothing is kept: the proof-of-work
  check and the form state live in memory only.
- So there is nothing for a consent banner to ask about, and none is shown.
  The exemption for storage that is strictly necessary to provide a service
  the user asked for (regulation 6 of the Privacy and Electronic
  Communications Regulations, general knowledge, for the solicitor's check)
  is not even needed, since nothing is stored.
- [ADR 0033](0033-consent-and-communications.md) agrees: it records consent
  per purpose for mail, sets no cookie and does no tracking, and gives the
  embed nothing to store.
- Browsers partition storage in third-party frames. If a later version keeps
  a respondent's progress in the frame, it is kept per embedding site, and
  the page must say so.

### Custom domains

Deferred. No host other than the configured console, portal and embed hosts
is answered, and nothing maps a host to a tenant.

Revisit when a funder needs one, with each of these settled first:

- **Host-to-tenant mapping:** a host maps to one tenant and selects it in
  place of the slug, in one table read only through an approved definer
  function, and the proxy answers only mapped hosts.
- **Proof of domain control:** a DNS token issued for that tenant and host,
  as SSO domains are verified (ADR 0010), checked again on a schedule, with
  the mapping withdrawn if it fails.
- **Certificates:** issued and renewed automatically, through Google-managed
  certificates on the load balancer in the managed service and the proxy's
  ACME module in a self-hosted stack, which ADR 0030 left off by default
  because it needs a route out to a certificate authority. Renewal failures
  are alerted on well before expiry.
- **Cells:** a tenant is pinned to one cell (ADR 0012, hosting targets,
  being drafted). A custom domain points at that cell's load balancer, and
  moving the tenant to another cell (hosting phases 2 and 3) means a DNS
  change the funder makes, which the move procedure must allow for.
- **Cookie scope:** only the embed origin may use a custom domain, never the
  console or portal. The embed origin sets and reads no cookies, and
  session cookies are host-only on the app hosts, so a custom domain cannot
  widen where a session cookie goes. A custom host under the funder's own
  domain, such as `forms.funder.example`, would receive the funder's own
  parent-domain cookies; the proxy's removal of `Cookie` on embed hosts
  keeps them out of the API and its logs.

### Programme browsing

Joins ADR 0019's public pages and ADR 0003's approved definer functions:

| Function                          | Callable by | Returns                                                                                                                                                                                                                                                                                                                    | Its owner holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grants.public_open_rounds(slug)` | `app_api`   | For an active tenant with grants switched on: each open round's id, programme title and summary, round title, opening and closing instants, timezone, award minimum and maximum in minor units with currency, and eligibility summary; at most 100, by closing time then round title; nothing otherwise, never a tenant id | `SELECT` on `id`, `slug` and `status` of `app.tenant`; on `tenant_id`, `module` and `enabled` of `app.tenant_module`; on `tenant_id`, `id`, `title`, `summary` and `status` of `grants.programme`; on `tenant_id`, `id`, `programme_id`, `title`, `opens_at`, `closes_at`, `timezone`, `award_min_minor`, `award_max_minor` and `currency` of `grants.round`; and on `tenant_id`, `round_id`, `status` and `definition` of `grants.form_version`; each with a `SELECT` policy `TO` it that is `USING (true)` |

- An open round is one whose programme is `open`, whose opening time has
  passed and closing time has not, and which has a published form version:
  the same test as the portal's signed-in open-rounds rule.
- Decided: the eligibility summary is derived from the round's published
  form version, as the label and stop explanation of each
  eligibility-flagged field, which applicants already see after sign-in.
  No staff-written column is added. The function extracts those two strings
  only, capped at the form engine's limits, and nothing else from the
  definition.
- Its owner is `owner_grants_public_open_rounds`, `NOLOGIN`, with
  `search_path = pg_catalog, pg_temp`. It compares the slug exactly, raises
  nothing on caller input, and sets no tenant. Like ADR 0019's functions, it
  resolves the tenant inside itself and adds no tenant source.
- Served as `GET /public/tenants/{slug}/rounds` and
  `GET /public/tenants/{slug}/rounds/{round id}` (the second filters the
  first), under the public rate limit (S11-36). An unknown, suspended or
  switched-off tenant and a round that is not open all get the same 404.
- Reading public fields is not a sensitive read and writes no audit event.

The catalogue test knows each new function by one entry, named by object
and reason rather than file position:

- `grants.public_open_rounds(text)`: "public fields of a tenant's open
  rounds by slug, with no tenant set";
- `app.embed_origins(text)`: "a tenant's allowed embedding origins by slug,
  with no tenant set".

`app.embed_origin` is an ordinary tenant table and needs no exception.

### TLS and the proxy

- TLS for the embed host ends at the reverse proxy chosen in ADR 0030, with
  its own certificate and the same TLS and HSTS settings as the other hosts.
- The proxy's host rules gain the embed host, with the forwarding and
  header removal above. Everything else in ADR 0030 applies to it
  unchanged: refused path forms, body limits, rate limits and logs without
  query strings or client addresses.
- The managed service maps the same rules onto Google Cloud's external
  Application Load Balancer, configured only under `infra/terraform/`: a
  Google-managed certificate for the embed host, a host rule sending
  `/api/public/tenants/` to the API and everything else to the web backend
  in embed mode, a 404 for other API paths, and `Cookie` and `Set-Cookie`
  removed in the route's header actions. No code changes between the two
  ([rule 1](../ARCHITECTURE.md)).

### Later users of the same origin

Both arrive in Q1 2027 and follow every rule above, with their own paths
under the tenant's slug and their own routes on the forwarding list:

- **Eligibility widget:** runs the domain package's eligibility rules in
  the browser, is stateless and collects no personal data. It reads the
  rounds through `grants.public_open_rounds()` or a function in the same
  pattern, and turns `app.embed_origins()`'s module check on for grants.
- **Charity and company lookup widget:** calls registries only through the
  API's outbound dispatcher, never from the browser. Cached results hold
  trustees' and directors' names, which are personal data, so they are
  classified and retained like any other.

## Consequences

- This extends ADR 0019 (programme browsing, embed origins, custom domains
  deferred), ADR 0006 and ADR 0022 (a third origin with its own policy, from
  an embed mode of the same server) and ADR 0030 (the embed host's routing
  and header removal, which amends its rule that the proxy changes no
  header), and ADR 0010's host resolution gains the embed host. Each gains
  an "Extended by ADR 0035" line, or "Amended by" for ADR 0030, when this
  ADR is accepted, and none is edited before then. ADR 0028 is unchanged.
- No anonymous request runs with a tenant set; ADR 0003's tenant sources are
  unchanged and its approved functions gain two rows. The roles script gains
  two `NOLOGIN` owners, `owner_grants_public_open_rounds` and
  `owner_app_embed_origins`, with a roles version bump.
- The console and portal policy does not change. A test fails if the embed
  policy ever appears on either app's host.
- Funders need a second domain name only if they self-host; the managed
  service provides the embed domain.
- An embed cannot be signed in to, so signed-in forms open the portal.
- Rule 2: `app.embed_origin` has `tenant_id`, forced row-level security and
  a cross-tenant denial test; the two functions are named approved
  functions, not exceptions to row-level security.
- Rule 5: `app.embed_origin`'s columns are classified internal, with the
  tenant's retention.
- New contracts entry points that build on this ADR
  (`modules/grants/src/contracts/public/`, S12-08) import the zod switch in
  `packages/domain/src/jitless/` first and are covered by the jitless test.
- The work this creates: S12-08 (the origin schema, the public and console
  routes, the config type and audit actions, and the browsing contracts),
  S12-48 (`app.embed_origin`, `app.embed_origins()` and
  `grants.public_open_rounds()`), S12-55 (the public reads and the console
  routes), S12-64 (the portal's browsing screen), S12-65 (the settings
  field) and S12-75 (the embed mode, the proxy's embed host, Compose and
  Helm, and the load balancer rules).

## Dependency check

No dependency is added. The nonce and origin checks use `node:crypto` and
the WHATWG `URL` parser built into Node.js and the browsers.
