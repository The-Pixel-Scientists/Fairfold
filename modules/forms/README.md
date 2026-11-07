# Fairfold Forms

**Planned for launch in 2027.** Nothing is built here yet.

Forms and surveys for feedback, registrations and more, built on the same form
engine as grant applications.

Like every Fairfold tool, Fairfold Forms will work on its own or alongside the
others. It will run on the shared platform: accounts and permissions, an audit
log, the shared record of organisations and people, and the data warehouse.
See the [project README](../../README.md) for the whole suite and what is
built today.

Code name: `forms`.

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
| Database schema | `forms` |
| Migrations | `packages/db/migrations/NNNN_forms_<description>/` |
| Field classification | `packages/db/classification/forms.ts` |
| Generated database types | `packages/db/src/generated/forms.ts` |
| Published contracts | `modules/forms/src/contracts/` |
| Routes and services | `modules/forms/src/server/` |
| Staff screens | `modules/forms/src/console/` |
| Applicant and respondent screens | `modules/forms/src/portal/` |
| Guides | `modules/forms/docs/` |

Its entry points, `@pixel-scientists/forms/contracts`, `/server`, `/console`
and `/portal`, follow the same import rules as every module's (see the
[party module](../party/README.md#entry-points)), and `pnpm check` enforces
them.
