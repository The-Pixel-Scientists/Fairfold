# Fairfold Data Protection

**Planned for launch in 2027.** Nothing is built here yet.

Subject access requests, breaches, data protection impact assessments and
records of processing, using how every Fairfold tool classifies its data.

Like every Fairfold tool, Fairfold Data Protection will work on its own or
alongside the others. It will run on the shared platform: accounts and
permissions, an audit log, the shared record of organisations and people, and
the data warehouse. See the [project README](../../README.md) for the whole
suite and what is built today.

Code name: `privacy`.

## Switching it on

The module is registered with the platform, but nothing in it can be used
yet: it has no routes or screens, and tenants can't switch it on until the
platform's module switch supports it. Once it can, no tenant has it unless a
tenant admin switches it on
([ADR 0024](../../docs/adr/0024-no-tool-on-by-default.md)). Switching it off
keeps its data, which returns when it is switched back on.

## What belongs to this module

| What | Where |
| --- | --- |
| Database schema | `privacy` |
| Migrations | `packages/db/migrations/NNNN_privacy_<description>/` |
| Field classification | `packages/db/classification/privacy.ts` |
| Generated database types | `packages/db/src/generated/privacy.ts` |
| Published contracts | `modules/privacy/src/contracts/` |
| Routes and services | `modules/privacy/src/server/` |
| Staff screens | `modules/privacy/src/console/` |
| Applicant and respondent screens | `modules/privacy/src/portal/` |
| Guides | `modules/privacy/docs/` |

Its entry points, `@pixel-scientists/privacy/contracts`, `/server`, `/console`
and `/portal`, follow the same import rules as every module's (see the
[party module](../party/README.md#entry-points)), and `pnpm check` enforces
them.
