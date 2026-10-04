# Grants

The grants module runs a funding round end to end: programme set-up,
applications, eligibility, assessment, private decisions, release and data
export. It is on by default, and a tenant admin can switch it off; its data
stays and returns when it is switched back on
([ADR 0016](../../docs/adr/0016-modular-suite-and-shared-warehouse.md)).

## What belongs to this module

| What | Where |
| --- | --- |
| Database schema | `grants` |
| Migrations | `packages/db/migrations/NNNN_grants_<description>/` |
| Field classification | `packages/db/classification/grants.ts` |
| Generated database types | `packages/db/src/generated/grants.ts` |
| Code | `modules/grants/src/` |
| Guides | `modules/grants/docs/` |

Its database work stays in `packages/db`, so one migration runner, one
catalogue test and one classification map cover every module. The runner
refuses a migration folder that names a schema it does not know.

Grants tables refer to organisations and people only through the keys the
party module publishes (`party.party`, `party.organisation`, `party.person`),
composite with `tenant_id` and `ON DELETE RESTRICT`, and read party data
through `@pixel-scientists/party/contracts` and `@pixel-scientists/party/server`.

## Entry points

| Import | Holds | May import |
| --- | --- | --- |
| `@pixel-scientists/grants/contracts` | Data and route contracts and events, safe for the browser | `zod`, `@pixel-scientists/domain`, other modules' contracts |
| `@pixel-scientists/grants/server` | Routes and services. `src/server/index.ts` is the in-process contract other modules call | Its own contracts, `@pixel-scientists/db` and the generated types for the `grants` schema only, `@pixel-scientists/domain`, other modules' contracts and server |
| `@pixel-scientists/grants/console` | Staff and reviewer screens | Its own contracts, other modules' contracts, `@pixel-scientists/ui`, `@pixel-scientists/domain`, React |
| `@pixel-scientists/grants/portal` | Applicant screens | Its own contracts, other modules' contracts, `@pixel-scientists/ui`, `@pixel-scientists/domain`, React |

`eslint.config.js` enforces these rules, so `pnpm check` fails on any other
import, whether static, dynamic or through `require()`, and on a relative
path that leaves the entry point or its module's contracts. Code outside the
four entry point folders fails too. Tests are exempt. The apps may import
any entry point.

A feature that crosses modules starts with a contract change, landed before
the code that uses it.
