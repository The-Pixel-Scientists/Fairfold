# Fairfold Reporting

**Planned for launch in 2027.** Nothing is built here yet.

Reports for trustees and regulators from the shared data warehouse.

Like every Fairfold tool, Fairfold Reporting will work on its own or alongside
the others. It will run on the shared platform: accounts and permissions, an
audit log, the shared record of organisations and people, and the data
warehouse. See the [project README](../../README.md) for the whole suite and
what is built today.

Code name: `insight`.

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
| Database schema | `insight` |
| Migrations | `packages/db/migrations/NNNN_insight_<description>/` |
| Field classification | `packages/db/classification/insight.ts` |
| Generated database types | `packages/db/src/generated/insight.ts` |
| Published contracts | `modules/insight/src/contracts/` |
| Routes and services | `modules/insight/src/server/` |
| Staff screens | `modules/insight/src/console/` |
| Applicant and respondent screens | `modules/insight/src/portal/` |
| Guides | `modules/insight/docs/` |

Its entry points, `@pixel-scientists/insight/contracts`, `/server`, `/console`
and `/portal`, follow the same import rules as every module's (see the
[party module](../party/README.md#entry-points)), and `pnpm check` enforces
them.
