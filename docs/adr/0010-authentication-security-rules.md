# ADR 0010: Authentication security rules

- **Status:** accepted
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

[ADR 0007](0007-authentication.md) chose Better Auth, embedded in the API. Its
defaults are not enough on their own: it creates a password account before
the email address is verified, stores session tokens as issued and backup
codes reversibly, mounts every route of each plugin it loads, and checks SSO
endpoint addresses once without pinning them. One person can be
staff at one funder and an applicant at another, so accounts span tenants,
while memberships and SSO providers each belong to one.

This ADR sets the rules our integration in `apps/api/src/auth` must meet, for
epic [E2](../V1-PLAN.md#e2-identity-and-access) and the OWASP ASVS level 2
pen test before Gate 1. Each rule has a test, and the tests run on every
upgrade of Better Auth or its plugins.

## Options considered

Six of the rules below were real choices:

1. **Failed sign-ins.** A lockout after repeated failures lets anyone who
   knows an email address lock its owner out. A progressive delay per
   identifier and client slows guessing without that. Chosen: the delay, with
   no lockout.
2. **Breached-password check.** Always on breaks installs without internet
   access; always off lets people choose passwords known from breaches.
   Chosen: on by default, with an operator setting to turn it off, and a
   bundled list of common passwords checked either way.
3. **Encrypted SAML assertions.** Accepting them (RSA-OAEP with AES-GCM only)
   adds a decryption path in XML libraries with a poor advisory record.
   Refusing them leaves the assertion protected by TLS, and visible to the
   user's own browser. Chosen: refuse them in V1.
4. **Where auth events go.** Some have no tenant (a failed sign-in for an
   unknown address), and `app_auth` cannot write outside `auth`. Chosen: an
   append-only `auth.audit_event`, plus a copy in the tenant's audit log when
   the user holds a membership in that tenant.
5. **Sign-up.** Asking for a password at sign-up lets someone register an
   address they do not control and hold a credential on it before its owner
   arrives (account pre-hijacking). Asking for the address first, and for a
   credential only once the emailed link is followed, adds one step. Chosen:
   email first.
6. **Hosts.** Two host names give the console and portal separate origins.
   One host is simpler to install, but lets a cross-site scripting bug in the
   portal reach console routes. Chosen: two hosts, recommended and used by
   the managed service; one host allowed, with a warning.

## Decision

### Data and roles

- Schema `auth` holds users, sessions, accounts, verification values,
  two-factor data, passkeys, SSO providers, used SAML assertion ids,
  rate-limit counters and `auth.audit_event`. Only `apps/api/src/auth`
  reaches it, as `app_auth`, whose rights outside `auth` are limited by
  [ADR 0003](0003-query-builder-and-migrations.md#roles).
- The app roles have no grants in `auth`. Their one way in is
  `auth.session_context(token_hash)`, which returns user id, active tenant,
  app, MFA state and expiry for a live session, and nothing for any other
  token. A test proves each app role can select from no `auth` table.
- SSO providers carry `tenant_id` under RLS. Only our own tenant-scoped routes
  create or change them; Better Auth's registration routes are disabled.
- SSO identities are Better Auth's `account` rows for an SSO provider. We add
  `tenant_id` and a uuid `sso_provider_id`, which a `BEFORE INSERT` trigger
  sets from the provider in the current tenant, raising an error if it finds
  none. A composite foreign key ties them to `auth.sso_provider`, and
  `app_auth` cannot update either. Only credential (password) accounts have
  neither, which checks enforce, so the table's policy is ADR 0003's named
  exception.
- Before sign-in, ADR 0003's sign-in tenant helper sets the tenant named in a
  sign-in or callback URL, as `app_auth`, only to read and write that
  tenant's SSO rows.
- Memberships, roles, invitations and applicant profiles are tenant tables
  outside `auth`. Better Auth's organisation plugin is not used.
- Every `auth` column is classified with a retention rule. A session's IP
  address and User-Agent go with its row, at most 90 days after it ends.

### Better Auth configuration

- Only the routes on our allowlist are mounted; every other route is in
  `disabledPaths`. A test compares the mounted routes with the allowlist.
- Sign-up is email first, through our own routes (see
  [Accounts, memberships and invitations](#accounts-memberships-and-invitations)):
  `emailAndPassword.disableSignUp: true`, `requireEmailVerification: true`
  and `autoSignIn: false`;
  `emailVerification.autoSignInAfterVerification: false`. Better Auth's
  `/sign-up/email` and `/verify-email` are off the allowlist.
- `session.cookieCache.enabled: false`, so every request reads the session
  and a revocation applies at once.
- `accountLinking.enabled: false` and `trustEmailVerified: false`.
- `trustedOrigins` holds exactly the console and portal origins, with no
  wildcards. A `callbackURL`, `redirectTo` or `errorCallbackURL` not on the
  requesting app's exact origin is refused.
- A Fastify hook runs before Better Auth on every request other than `GET` or
  `HEAD`, except the SAML ACS `POST`. It refuses a body that is not JSON, and
  requires `Origin` to equal the origin of the app the host resolved to, so
  with two hosts a portal page cannot post to a console route. On a single
  host both apps share one origin, and the check cannot separate them.
- Only core and the two-factor, passkey and SSO plugins; telemetry off.
- A Semgrep rule bans importing `better-auth` outside `apps/api/src/auth`
  ([ADR 0002](0002-licence-and-dependency-policy.md)).

### Secrets at rest

| Value | Stored as |
| --- | --- |
| Session tokens | SHA-256 hash; our adapter hashes the presented token on lookup |
| Verification values | Hashed (`verification.storeIdentifier: "hashed"`) |
| TOTP secrets | Encrypted by Better Auth with the auth secret |
| SSO client secrets, SP private keys | Encrypted by our adapter; no route returns them after save |
| Backup codes | HMAC-SHA-256; shown once, when generated |

- Keys are held outside the database. The auth secret is a mounted secret
  file ([ADR 0005](0005-dev-topology.md)). Our adapter derives one key per
  purpose from it with HKDF-SHA-256, and each stored value records its key
  version.
- Our adapter encrypts with AES-256-GCM and a random 96-bit nonce, with the
  table, column, row id and tenant id as associated data, so a value copied
  to another row or tenant fails to decrypt.
- The API refuses to start if the auth secret is missing, shorter than 32
  bytes, or a known default or development value. Better Auth only warns
  about a short secret, and rejects its default only in production.
- Rotation uses Better Auth's versioned `secrets`: the new version encrypts
  and old versions only decrypt. Before an old version is removed, a one-off
  command in `apps/api/src/auth` re-encrypts TOTP and SSO secrets as
  `app_auth`, since the worker has no `auth` access. It finds SSO providers
  through the approved function `auth.sso_providers_by_key_version()`
  ([ADR 0003](0003-query-builder-and-migrations.md#approved-definer-functions))
  and sets each one's tenant with the sign-in tenant helper. The function
  does not filter by tenant status, so suspended tenants' secrets are
  re-encrypted too, and a Semgrep rule bans calling it anywhere else. The
  command writes a "secrets re-encrypted" auth event with the key version
  and count. Backup codes cannot be re-keyed, so users whose codes use that
  version are asked to generate new ones first. The runbook is rehearsed on
  staging before Gate 1.
- Our own route verifies backup codes, not Better Auth's. It compares in
  constant time with the stored HMACs and removes the used code in the same
  transaction.
- Our own check verifies every TOTP code, at sign-in, to confirm enrolment
  and for step-up re-authentication, and each code works once. In one
  transaction it locks the user's last accepted time step, refuses a code
  for that step or an earlier one, and records the new step. Better Auth's
  `/two-factor/verify-totp` and `/two-factor/verify-backup-code` are off the
  allowlist.
- Tests:
  - run sign-in, MFA enrolment, a reset, and registering an OIDC and a SAML
    provider, then read every `auth` table and fail if any issued token,
    code, secret or private key appears in clear;
  - fail if a stored backup code decrypts with the auth secret;
  - present a stored token hash as a session token and expect a 401;
  - call every SSO provider route and fail if a secret or private key comes
    back;
  - present an accepted TOTP code again, at sign-in, enrolment and step-up,
    and one code in two requests at once, and expect only the first use to
    succeed.

### Accounts, memberships and invitations

- Sign-up is email first. The person enters only an email address, and we
  email a single-use link. The link opens a page that changes nothing; its
  `POST`, with an allowed `Origin`, verifies the address, and on that page
  they set a password or register a passkey. The account is created,
  verified, with that first credential, so no credential exists before the
  inbox is proven. They then sign in.
- A pending sign-up expires after 24 hours, and a new sign-up for the same
  address replaces it. A sign-up for an address that already has an account
  emails an offer to sign in or reset the password instead, and the response
  is the same either way.
- An account belongs to one person and may hold memberships in several
  tenants. A membership belongs to one tenant.
- Tenant admins act on memberships only: suspend, remove, change roles, and
  revoke sessions whose active tenant is theirs.
- Account-level changes (email, password, MFA, deactivating the account) are
  made by the user after re-authentication, or by a platform operator through
  an audited runbook.
- Changing email needs re-authentication, verification of the new address
  and a notice to the old one. Users are also emailed when their password,
  MFA, passkeys or backup codes change.
- An invitation attaches only to an account with the invited email address
  that completed email-first sign-up, so its first credential was set only
  once its address was proven. It never attaches to an account an IdP
  created.

### Sessions

| Setting | Staff and reviewers (console) | Applicants (portal) |
| --- | --- | --- |
| Idle timeout | 30 minutes | 60 minutes |
| Absolute timeout | 12 hours | 24 hours |
| Warning before idle timeout | 2 minutes, with a button to stay signed in | The same; drafts are already saved |
| Waiting for MFA | 10 minutes | 10 minutes |
| Re-authentication counts as recent for | 5 minutes | 5 minutes |

- The console and portal each reach the API same-origin, so there is no
  CORS. Two host names, one per app, are recommended and used by the managed
  service; a single host is allowed (see [Consequences](#consequences)). A
  session belongs to the app it was created in. The API resolves the app
  from the request host, as Fastify derives it from its trusted proxy list
  and checked against the configured hosts, and on a single host from a
  fixed path prefix set in deployment configuration; never from a request
  parameter. Each app's session cookie has its own name. Staff and reviewer
  permissions work only in console sessions.
- A session is live when it is not revoked, its user is active, it is within
  its app's idle and absolute timeouts, and, if it is waiting for MFA, it is
  no more than 10 minutes old. `apps/api/src/auth` updates its last-seen
  time, as `app_auth`, at most once a minute.
- The active tenant is set at sign-in (from the sign-in URL, or the SSO
  provider's tenant) and on a switch. Every request checks the user's
  membership in it under RLS.
- A session created through an SSO provider is bound to that provider's
  tenant and cannot switch.
- Staff and reviewer permissions need completed MFA on every request: TOTP, a
  passkey with `userVerification: "required"`, or MFA asserted by that
  tenant's own IdP. Switching into a tenant where the user has such a role,
  without completed MFA, sends them to MFA.
- The session id changes on sign-in, MFA completion, a tenant switch and any
  privilege change.
- A session waiting for MFA reaches only the MFA routes. A test calls every
  other route with one and expects a 401.
- Changing MFA, email, password, SSO settings or roles, and releasing
  decisions, need re-authentication within the last 5 minutes. An SSO
  session re-authenticates at its IdP, with `prompt=login` and `max_age=0`
  (OIDC) or `ForceAuthn` (SAML), and the returned `auth_time` or
  `AuthnInstant` must be no more than 5 minutes old.
- A password reset, MFA change or account deactivation revokes every session
  the user has; a password or email change revokes all but the current one.
  Suspending or removing a membership revokes the sessions whose active
  tenant is that tenant.
- Cookies use the `__Host-` prefix and are Secure, HttpOnly and
  `SameSite=Lax`. Every request other than `GET` or `HEAD` must pass the
  `Origin` hook under [Better Auth configuration](#better-auth-configuration),
  except the SAML ACS `POST`, which relies on the signed assertion and
  `InResponseTo`. The only `GET` routes that change state, the OIDC callback
  and SAML completion, need a single-use token bound to the browser that
  started sign-in. Emailed links (sign-up, a new email address, a password
  reset) open a page that changes nothing; its `POST` does the work.

### Sign-in limits and passwords

This section is the documentation that ASVS 5.0 requirement V6.1.1 asks for:
how these limits slow credential stuffing and password guessing, and why no
one can use them to lock an owner out.

Counters live in Better Auth's database store in `auth`, shared by every API
instance. The client IP is the one Fastify derives from its trusted proxy
list, which our adapter passes to Better Auth. A client is a browser holding a
device cookie for the account, or failing that an IP address. Every per-IP
count, including the limits below, treats an IPv6 /64 as one address.

The device cookie is set when a sign-in completes and lasts 12 months. It
carries a random device id, the account id and the issue time, never an
email address, and is signed with its own purpose key. The server stores the
device id hashed, and a client's counters are keyed by it. A password reset,
account deactivation or "sign out everywhere" revokes the account's device
cookies. The cookie is classified.

| Action | Limit |
| --- | --- |
| Password sign-in, per identifier and client | 5 failures in 15 minutes, then a delay of 30 seconds, doubling with each further failure to at most 15 minutes |
| Password sign-in, per identifier, from clients without its device cookie | 100 failures an hour, then the same delays |
| Password sign-in, per IP, from clients without a device cookie for the account tried | 50 failures in 15 minutes, then the same delays |
| MFA code or backup code | 5 attempts per pending session, then it is discarded; each failure also counts towards the identifier and client's delay |
| Sign-up, reset and verification emails | 3 per address per hour; 20 per IP per hour |

- There is no lockout. A delay refuses password attempts without checking
  the password, with a generic message and `Retry-After`, and a refused
  attempt does not count as a failure. Passkey sign-in, SSO and password
  reset keep working, and failures from other clients never delay the owner
  on a device they have signed in from before.
- The doubling resets after 24 hours without a failure. A completed password
  reset clears the identifier's counters and delays.
- Identifiers are normalised. A counter key or audit event keeps one as
  typed only if it matches an account or is a valid email address, and
  otherwise an HMAC of it under its own purpose key, since it is often a
  mistyped password.
- Responses are generic, and the same for unknown identifiers: a failed
  sign-in never says whether the account exists, delays count unknown
  identifiers in the same way, and reset and sign-up requests give the same
  answer either way.
- Passwords are at least 12 characters, and at least 128 are accepted.
- Passwords are hashed with Argon2id at OWASP's minimum parameters (19 MiB,
  2 iterations, 1 lane) through Node.js's built-in `crypto.argon2`. Better
  Auth's default, scrypt with N=16384, r=16, p=1, is below OWASP's scrypt
  parameters. For an unknown identifier a dummy hash is computed, so timing
  does not reveal whether an account exists.
- Every new password is checked against a bundled list of at least the 3,000
  most common passwords. This needs no network and cannot be turned off.
- New passwords are also checked against known breaches through the Have I
  Been Pwned range API with `Add-Padding: true`. Only the first five
  characters of the password's SHA-1 hash leave the server, and they are
  never logged. If the service does not answer within 3 seconds, the password
  is accepted, the miss logged and the account flagged "check pending";
  nothing derived from the password is kept. The next password sign-in
  checks it again, and the flag clears once the service answers. If it is
  breached, the sign-in does not complete: the user changes the password
  after completing MFA or through an emailed reset link, never with the
  breached password alone.
- The breach check is on by default. An operator setting turns it off for
  offline installs. The self-hosting guide documents the setting and its
  cost: passwords known from breaches are then accepted. Changing it is
  audited.

### SSO

- An SSO identity is keyed by tenant, provider, issuer and subject, and
  grants membership only in the provider's tenant, with no role until a
  tenant admin assigns one.
- A provider claims an email domain only after DNS verification of a random
  token issued for that tenant, provider and domain. The domain index is
  unique among verified rows only, so a verified domain belongs to one
  tenant at a time and a pending claim blocks nobody. A conflict is reported
  only after the DNS proof succeeds, with a generic message that names no
  tenant. Conflicts are audited, and the operator settles disputes by
  runbook.
- An IdP may create or sign in a user only for an email address in one of
  its provider's verified domains; any other asserted email is refused.
- OIDC `state` and the SAML request id are single-use and bind the tenant and
  provider. A callback naming another tenant or provider is refused.
- Sign-in completes only in the browser that started it: a cookie set at the
  start must match at the end. For SAML, the ACS route checks the response,
  then redirects with a single-use completion handle, valid for 2 minutes, to
  a same-site route that checks the cookie before creating the session.
- Staff signing in by SSO must have MFA asserted by the IdP (OIDC `amr` or
  `acr`, SAML `AuthnContextClassRef`, mapped per provider) or complete local
  MFA.
- Changing a provider or its domains needs recent re-authentication, and is
  audited and versioned like other configuration.
- Every endpoint URL in a pasted or fetched discovery or metadata document is
  checked on save: HTTPS only, no IP literal the dispatcher would refuse (see
  below), and no credentials in the URL.
- OIDC uses the authorisation code flow with PKCE, `state` and `nonce`. The ID
  token's issuer and audience are checked, and its algorithm must be RS256,
  PS256 or ES256; `none` and HMAC algorithms are refused.
- SAML rules:
  - SP-initiated only (`allowIdpInitiated: false`). AuthnRequests use the
    HTTP-Redirect binding, so no auto-submitting page is needed under our CSP
    ([ADR 0006](0006-design-system.md)).
  - Assertions must be signed, and are verified only against the
    certificates configured for the provider. `KeyInfo` in the document is
    ignored.
  - Checked: the assertion's `Issuer` against the provider's entity id,
    `Audience`, `Recipient`, `Destination`, `InResponseTo`, `NotBefore` and
    `NotOnOrAfter` (`requireTimestamps: true`).
  - Signatures must use RSA-SHA256 or stronger, with SHA-256 or stronger
    digests. Every SHA-1 algorithm is refused.
  - Encrypted assertions are refused.
  - `RelayState` is never used as a redirect target.
  - Used assertion ids are kept until they expire, to refuse replays. A
    response or IdP metadata document containing a DTD is refused before
    parsing. Single logout stays off.

### Outbound requests

These rules cover all outbound HTTP from the API and the worker, not only SSO.

- One undici dispatcher, set with `setGlobalDispatcher` in the first module
  each process loads, carries every `fetch`, so library code such as Better
  Auth, jose and samlify is covered. Requests through `node:http` and
  `node:https` meet the same rules through their global `Agent` objects.
- At connect time it resolves the host and allows only addresses that the
  IANA IPv4 and IPv6 special-purpose address registries leave as globally
  reachable unicast. Everything else is refused, including cloud metadata
  addresses, 0.0.0.0/8, 192.0.0.0/24, 198.18.0.0/15 and 240.0.0.0/4. IPv4
  embedded in IPv6 (IPv4-mapped, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`,
  6to4 and Teredo) is decoded and must pass too. IP literals meet the same
  rules, and the dispatcher connects to the address it checked.
- The dispatcher itself enforces, on every request including those libraries
  make: HTTPS only; at most 3 redirects, each a new checked connection; a
  1 MB response body; and connect and response time limits.
- The API and worker refuse to start if `NODE_USE_ENV_PROXY`, `HTTP_PROXY` or
  `HTTPS_PROXY` is set, in either case, because a proxy would resolve names
  where we cannot check them.
- Fixed destinations (SMTP, S3, clamd, the Have I Been Pwned API) are named
  in configuration and reached only through their own clients, each pinned to
  its configured host and port. The global dispatcher has no exceptions.
- As defence in depth, the Compose and Helm deployments deny the API and
  worker egress to metadata addresses and private ranges, except to the
  services they name.

### Audit

- `app_auth` writes each auth event to `auth.audit_event` in the same
  transaction as the change it records, with `INSERT` and `SELECT` only. The
  database sets `occurred_at` and `retain_until`, rows are kept 12 months,
  and only the audit purge removes them
  ([ADR 0003](0003-query-builder-and-migrations.md#audit-retention-the-exception-to-rule-4)).
  Every column is classified.
- When the user holds a membership in the event's tenant, the audit module
  then copies the event to that tenant's `audit_event`, as ids and codes, as
  `app_api` with the tenant from the acting or new session. The copy is keyed
  by the auth event id, so a retry cannot duplicate it.
- The auth transaction also writes a pending-copy row in `auth`, holding
  only the auth event id and a timestamp, with no `tenant_id`. It is
  classified, and deleted once the copy succeeds. The API, as `app_auth`,
  exposes the age of the oldest pending row as a metric, and one older than
  10 minutes raises an alert. The operator then runs the replay command in
  `apps/api/src/auth`, which takes the tenant from the auth event
  ([ADR 0003](0003-query-builder-and-migrations.md#tenant-context-and-queries),
  source 5). Each replay is audited.
- Events: sign-in succeeded or failed; signed out; rate limit reached;
  account created or membership granted through SSO; password reset
  requested or completed; password or email changed; MFA enrolled or
  removed; MFA code failed; pending session discarded; backup code used;
  backup codes regenerated; passkey added or removed; step-up
  re-authentication; active tenant switched; SSO session created; SSO
  response rejected, with a reason code; SSO provider or domain changed; SSO
  domain conflict; invitation accepted; sessions revoked; account
  deactivated; membership suspended or removed; secrets re-encrypted, with
  the key version and count; audit copy replayed.
- Passwords, codes, tokens, cookies, raw assertions and ID tokens are never
  logged or audited. Typed identifiers, kept as set out under sign-in
  limits, and client IP addresses are personal data, kept with their event
  for 12 months.

### Tests

Besides the tests named above, each rule has at least one test, including:

- SSO: wrapped, unsigned, replayed, expired and wrong-audience assertions; a
  wrong `Issuer`; a signature by a `KeyInfo` key that is not configured; a
  SHA-1 signature; an encrypted assertion; a DTD in a response or in IdP
  metadata; an IdP-initiated response; ID tokens with `alg: none`, the wrong
  issuer or a reused nonce; email-based linking; a provider from another
  tenant; a callback naming another tenant or provider; a response completed
  in another browser, or with an expired or reused completion handle; SSO
  without asserted MFA; a foreign-domain assertion; a domain already
  verified by another tenant, refused only after its DNS proof and without
  naming that tenant; another tenant's pending claim, which blocks nothing;
  a DNS token issued for another tenant, provider or domain; an SSO session
  switching tenant; step-up with a stale `auth_time` or `AuthnInstant`; and
  an invitation to an SSO-created account.
- Redirects: a `callbackURL`, `redirectTo` or `errorCallbackURL` on another
  origin is refused, and a `RelayState` URL is never followed.
- Outbound: each endpoint in a discovery or metadata document (JWKS, token,
  userinfo, SAML metadata and SSO URLs) pointing at 169.254.169.254 or a
  loopback address, both pasted and fetched, directly and through a
  redirect; an address in each refused range, including IPv4 embedded in
  NAT64, 6to4 and Teredo addresses; plain HTTP, a fourth redirect and an
  oversized body, through `fetch` and through `node:https`; and start-up
  with a proxy variable set.
- Sign-up (pre-hijacking): an attacker signs up with the victim's address
  first, then the victim verifies, once directly and once after a
  link-scanning `GET`. The `GET` changes nothing, and the account ends with
  only the credential the victim set.
- Sessions: each timeout; a portal session on a staff route; a staff
  permission without completed MFA; a switch into a staff tenant without
  MFA.
- Hosts and origins: a portal-origin `POST` to a console route, and a body
  that is not JSON, are refused; the same host on different ports counts as
  one host; a spoofed `X-Forwarded-Host` does not change the app a request
  resolves to.
- Passwords: a "check pending" password found breached at the next sign-in
  can be changed only after MFA or through a reset link.
- Limits: a delay for an unknown identifier looks the same as for a known
  one; passkey, SSO and reset work during a delay; attempts refused during a
  delay do not count; failures from another client do not delay the owner on
  a known device; a device cookie stops counting after a reset, deactivation
  or "sign out everywhere"; a completed reset clears the counters and
  delays; and a spoofed `X-Forwarded-For` does not change the address that is
  counted.

## Consequences

- We own more code around Better Auth: the adapter, email-first sign-up, the
  backup-code and TOTP routes, the dispatcher and the audit copies. The tests above run on every
  upgrade.
- Tenant admins cannot reset anyone's password or MFA. Lost MFA goes to the
  platform operator's runbook (E12), which is audited.
- [E2](../V1-PLAN.md#e2-identity-and-access)'s "deactivate users" is met in a
  tenant by suspending the membership. Deactivating the account itself is a
  platform operation.
- Someone with both a staff role and an applicant profile signs in to the
  console and the portal separately.
- Two host names, one per app, are the recommended set-up and the managed
  service's. A single-host install works, but the API logs a warning at
  start-up, and the self-hosting hardening guide explains the risk: both
  apps share an origin, so a cross-site scripting bug in the portal could
  reach console routes.
- Host names are compared after normalising case, a trailing dot and IDNA,
  ignoring the port, since cookies do not separate ports. Two configured
  hosts that differ only by port are one host.
- Offline installs can turn off the breached-password check, at the cost
  stated above; the bundled common-password list still applies.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| undici | 7.29.1 | MIT | 2026-09-04 | Node.js project; the version bundled with Node.js 24.21.0; provenance attested; 20 advisories in 12 months (8 high), mostly in WebSocket, cache and proxy code, none affecting 7.29.1 |
