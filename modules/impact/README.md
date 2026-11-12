# Fairfold Impact

**Planned for launch in 2027.** The database schema and the API routes are built; the staff screens are not.

Outcomes, indicators and evidence from grants and activities, so trustees can
see what difference the money makes.

Like every Fairfold tool, Fairfold Impact will work on its own or alongside
the others. It will run on the shared platform: accounts and permissions, an
audit log, the shared record of organisations and people, and the data
warehouse. See the [project README](../../README.md) for the whole suite and
what is built today.

Code name: `impact`.

## Switching it on

The module is registered with the platform and its routes answer for a
tenant that has it on, but it has no screens yet, and tenants can't switch
it on until the platform's module switch supports it. Once it can, no tenant has it unless a
tenant admin switches it on
([ADR 0024](../../docs/adr/0024-no-tool-on-by-default.md)). Switching it off
keeps its data, which returns when it is switched back on.

## What belongs to this module

| What                             | Where                                               |
| -------------------------------- | --------------------------------------------------- |
| Database schema                  | `impact`                                            |
| Migrations                       | `packages/db/migrations/NNNN_impact_<description>/` |
| Field classification             | `packages/db/classification/impact.ts`              |
| Generated database types         | `packages/db/src/generated/impact.ts`               |
| Published contracts              | `modules/impact/src/contracts/`                     |
| Routes and services              | `modules/impact/src/server/`                        |
| Staff screens                    | `modules/impact/src/console/`                       |
| Applicant and respondent screens | `modules/impact/src/portal/`                        |
| Guides                           | `modules/impact/docs/`                              |

Its entry points, `@pixel-scientists/impact/contracts`, `/server`, `/console`
and `/portal`, follow the same import rules as every module's (see the
[party module](../party/README.md#entry-points)), and `pnpm check` enforces
them.
