# Platform

The platform is the part every tool shares: accounts, permissions, tenants,
the audit log, files, settings, retention, subject access and erasure. It is
always on. This page covers what personal data it holds and what controls sit
beyond the [control mapping](../control-mapping.md).

## Personal data it holds

From the records of processing (`packages/db/src/records-of-processing.ts`),
checked on 19 November 2026:

| Schema | Tables | What they hold | Highest sensitivity |
| --- | --- | --- | --- |
| `auth` | 13 | Users, sessions, authenticator and passkey data, single sign-on settings, rate-limit counters, and the auth audit events | Personal |
| `app` | 21 | Tenants, memberships, invitations, settings, files, notes, messages, the audit log, the erasure ledger, repeat-request keys | Personal |
| `pgboss` | 9 | The job schema: ids and codes only | Internal |

A session holds an IP address and browser details. Both go with the session, at
most 90 days after it ends. Authenticator secrets are encrypted with the auth
secret. The auth schema is reached only through `apps/api/src/auth/`, by its
own database role: [ADR 0010](../../adr/0010-authentication-security-rules.md).

## Controls beyond the platform baseline

- Staff and reviewers need completed MFA on every request. Idle and absolute
  session timeouts apply. A password reset, MFA change or deactivation ends
  every session.
- Outbound requests pass one checked dispatcher: HTTPS only, public
  addresses only, three redirects at most.
- Uploads are scanned by ClamAV before they are stored
  ([ADR 0030](../../adr/0030-files-and-reverse-proxy.md)).
- Rate limits protect the public and sign-in routes.
- The job schema is the one named exception to tenant row-level security. Its
  guards are in [ADR 0009](../../adr/0009-background-jobs.md): ids only in a
  payload, a tenant id the database checks, separate roles for the API and
  worker, codes only for errors.

## Row-level security and audit

- Every tenant table carries `tenant_id` and a policy. The app role has no
  right to bypass row-level security. `packages/db/test/cross-tenant.ts` is
  the shared cross-tenant denial test, and the tests under
  `packages/db/test/app/` use it for the platform tables.
- The audit table is append-only for the app role. One approved function
  purges rows past a date the database sets, never below a platform minimum,
  and writes its own audit event: `packages/db/test/app/audit-purge.test.ts`.
- Sign-in, second-factor and account events go to `auth.audit_event`. A copy
  leaves the database through a pending table, so loss of the database does
  not erase the trail: [Audit copy runbook](../../runbooks/audit-copy.md).
- Configuration changes write a versioned record with author and diff:
  `apps/api/src/platform/config-versions.ts`.

## Open items

- The hardening guide is not yet available.
- A restore rehearsal record is not yet available.
- An external penetration test is not yet available.
