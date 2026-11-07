# Fairfold CRM

**The full CRM is planned for launch in 2027.** Nothing is built here yet.

Relationships, interactions and consent for the organisations and people you
work with. It builds on the shared record of organisations and people that
every Fairfold tool uses, which is part of the platform and is being built
now.

Like every Fairfold tool, Fairfold CRM will work on its own or alongside the
others. It will run on the shared platform: accounts and permissions, an audit
log, the shared record of organisations and people, and the data warehouse.
See the [project README](../../README.md) for the whole suite and what is
built today.

Code name: `crm`.

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
| Database schema | `crm` |
| Migrations | `packages/db/migrations/NNNN_crm_<description>/` |
| Field classification | `packages/db/classification/crm.ts` |
| Generated database types | `packages/db/src/generated/crm.ts` |
| Published contracts | `modules/crm/src/contracts/` |
| Routes and services | `modules/crm/src/server/` |
| Staff screens | `modules/crm/src/console/` |
| Applicant and respondent screens | `modules/crm/src/portal/` |
| Guides | `modules/crm/docs/` |

Its entry points, `@pixel-scientists/crm/contracts`, `/server`, `/console`
and `/portal`, follow the same import rules as every module's (see the
[party module](../party/README.md#entry-points)), and `pnpm check` enforces
them.
