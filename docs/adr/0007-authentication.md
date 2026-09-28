# ADR 0007: Authentication

- **Status:** proposed
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

Epic [E2](../V1-PLAN.md#e2-identity-and-access) needs: staff sign-in with
email, password and mandatory MFA (TOTP or WebAuthn); OIDC and SAML single
sign-on configurable per tenant; applicant sign-in with email verification and
optional MFA; session expiry and revocation; user deactivation. Auth events
are audited, personal data in auth records is classified and covered by
subject access and erasure, and the sign-in screens must meet WCAG 2.2 AA and
the [content style guide](../CONTENT-STYLE.md). A fresh self-hosted install
should take a competent admin under an hour. Auth code gets line-by-line
review, and an OWASP ASVS level 2 pen test comes before Gate 1. Some auth
data spans tenants (one person can be staff at two funders, or apply to
several), so it cannot sit in ordinary tenant tables.

## Options considered

1. **Better Auth, embedded in the API.** TOTP and backup codes in core,
   WebAuthn through its passkey plugin (built on SimpleWebAuthn), OIDC and
   SAML through its SSO plugin (SAML via samlify). It uses Kysely underneath,
   so its tables can sit in our database under our migrations.
2. **Keycloak, as a separate service.** TOTP, WebAuthn, OIDC and SAML
   brokering, and per-organisation identity providers are all built in. Our
   API becomes an OIDC client.
3. **Zitadel**: Keycloak's integration costs with a smaller community.
4. **Assemble our own** from openid-client, SimpleWebAuthn, otplib and a SAML
   library: the most security-critical code of any option.

| Criterion | Better Auth (embedded) | Keycloak (external) |
| --- | --- | --- |
| TOTP and WebAuthn | Two-factor and passkey plugins | Built in and long established |
| OIDC and SAML per tenant | SSO plugin, young code | Built in; brokering per organisation |
| Security code we own and review | Our integration and schema, plus a library in our process whose upgrades we read | Our OIDC client, session handling, event bridge and theme |
| GitHub advisories, last 12 months | 27 (2 critical, 17 high); 6 in the SSO, two-factor and passkey code, one a two-factor bypass | 23 (13 high); 3 involve SAML |
| Self-hosting weight | Nothing extra | One more JVM container (1,250 MB baseline), its own database, realm config and theme |
| Audit, subject access, erasure | Our tables, under our audit and classification | A second store; events bridged in, erasure through its admin API |
| Licence and upkeep | MIT; 17 releases since July 2026, fixes backported | Apache-2.0; CNCF, backed by Red Hat |
| SAML record (risky either way) | samlify and xml-crypto: critical signature bypasses since 2025 | Three high SAML advisories in 2026 |

## Decision

Aaron has chosen **Better Auth** (option 1), embedded in the API. Keycloak
(option 2) was the considered alternative and remains the fallback.

- Pin exact versions and use only core and the two-factor, passkey and SSO
  plugins. Telemetry is set off explicitly (it is off by default).
- Its tables are written as our own migrations, not through its CLI, in an
  `auth` schema (its `database.schemaName` option, added in 1.7.5).
- `apps/api/src/auth` exposes a narrow interface: current user, active
  tenant, MFA state, revoke sessions. Nothing else imports Better Auth, and
  a Semgrep rule enforces that. We build password and TOTP first, then
  passkeys, then OIDC, and SAML last.
- The rules the integration must meet, each with a test, are in
  [ADR 0010](0010-authentication-security-rules.md). In summary:
  - auth data sits in the `auth` schema, reached only through `app_auth`;
    tokens are hashed, TOTP and SSO secrets encrypted, and backup codes kept
    as HMACs, with keys held outside the database;
  - only the Better Auth routes we use are mounted, and sign-up is email
    first, so no password or passkey exists until the address is proven;
  - staff and reviewers need completed MFA on every request; sessions have
    idle and absolute timeouts; tenant admins act on memberships, not
    accounts;
  - failed sign-ins meet a progressive delay, never a lockout, and new
    passwords are checked against known breaches unless an operator turns
    the check off;
  - SSO is bound to the tenant that configured it and to its verified
    domains, SAML is SP-initiated, and all outbound requests go through a
    dispatcher that allows only globally reachable addresses;
  - auth events go to an append-only `auth.audit_event`, with a copy in the
    tenant's audit log when they concern a membership.

### Upkeep and advisories

Aaron owns auth advisories. He follows the GitHub advisory feeds for the
packages below, and fixes land within the [SECURITY.md](../../SECURITY.md)
targets (14 days for critical, 30 for high), using the security exception to
the release-age rule ([ADR 0001](0001-monorepo-toolchain.md)).

XML and crypto packages in the resolved tree under the SSO and passkey
plugins, with pnpm overrides set to the first patched version:

| Package | Resolved | Override floor | Reason |
| --- | --- | --- | --- |
| @xmldom/xmldom | 0.8.15 (under samlify), 0.9.12 (SSO plugin) | 0.8.15, 0.9.12 | 20 advisories in 2026, all fixed in these versions |
| xml-crypto | 6.3.0 | 6.0.1 | Critical signature bypasses, March 2025 |
| samlify | 2.13.1 | 2.13.0 | Signature wrapping (2025); XML injection (2026) |
| fast-xml-parser | 5.11.1 | 5.10.1 | Entity expansion advisories, 2026 |
| @simplewebauthn/server | 13.3.3 | 13.3.2 | Attestation check, September 2026 |
| @authenio/xml-encryption, xpath, node-rsa, xml, xml-escape | 2.0.2, 0.0.32 to 0.0.34, 1.1.1, 1.0.1, 1.1.0 | None | No advisories, but last released between 2016 and 2023 |

node-forge is not in the tree. Regression tests for past advisory classes
run on every upgrade of these packages: two-factor bypass, account takeover
through auto-linking or pre-registered accounts, SSRF in SSO registration,
SSO registration by the wrong user, stale sessions after deletion, IPv6
rate-limit bypass, deleting another user's passkey, open redirect through
callback URLs, SAML signature wrapping, XML injection in attribute values,
and XML comment or duplicate SignedInfo bypasses. We read the diff of every
plugin we use on each upgrade.

### When we would revisit

We reopen this decision, with Keycloak as the first alternative, if:

- a critical advisory in code we use goes unfixed past the SECURITY.md
  target, or two-factor or SSO bypasses keep recurring;
- keeping the rules in ADR 0010 needs a fork or a standing patch we cannot
  upstream;
- the project changes licence, turns telemetry on by default, or stops
  backporting fixes;
- the Gate 1 pen test finds a flaw rooted in the library's design;
- a design partner needs an identity feature it cannot provide.

## Consequences

- Sign-in screens are ours, built with `packages/ui`. Self-hosters run
  nothing extra for auth. MFA is mandatory for staff and offered to
  applicants.
- Hashed tokens, HMAC backup codes and encrypted SSO secrets rely on our
  adapter and hooks surviving each upgrade; the at-rest tests in ADR 0010
  catch a regression.
- The pen test scope names auth first, including SAML. A move to Keycloak
  would stay inside `apps/api/src/auth` and its migrations.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| better-auth | 1.7.5 | MIT | 2026-09-14 | Active; 30k stars; 1.7.6 is too new |
| @better-auth/sso | 1.7.5 | MIT | 2026-09-14 | Uses samlify 2.13 |
| @better-auth/passkey | 1.7.5 | MIT | 2026-09-14 | Uses @simplewebauthn/server 13 |
| samlify | 2.13.1 | MIT | 2026-05-18 | 661 stars; last push 2026-08-11 |
| xml-crypto | 6.3.0 | MIT | 2026-09-18 | Through samlify |
| Keycloak (considered) | 26.7.4 | Apache-2.0 | 2026-09-16 | Active; 37k stars |
| Zitadel (not chosen) | 4.19.1 | AGPL-3.0 | 2026-09-23 | Active; 15k stars |
| @node-saml/node-saml (not chosen) | 5.1.0 | MIT | 2025-07-21 | Two critical advisories July 2025 |
