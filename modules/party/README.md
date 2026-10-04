# Party

The party module is the master record of organisations, people, the
relationships between them and consent ([ADR 0017](../../docs/adr/0017-bespoke-crm-party-core.md)).
Every other module refers to its records rather than keeping its own. It is
part of the platform, so it is always on.

## What belongs to this module

| What                     | Where                                              |
| ------------------------ | -------------------------------------------------- |
| Database schema          | `party`                                            |
| Migrations               | `packages/db/migrations/NNNN_party_<description>/` |
| Field classification     | `packages/db/classification/party.ts`              |
| Generated database types | `packages/db/src/generated/party.ts`               |
| Code                     | `modules/party/src/`                               |
| Guides                   | `modules/party/docs/`                              |

Its database work stays in `packages/db`, so one migration runner, one
catalogue test and one classification map cover every module. The runner
refuses a migration folder that names a schema it does not know.

Other modules may hold a foreign key only to the keys this module publishes:
`party.party`, `party.organisation` and `party.person`, composite with
`tenant_id` and `ON DELETE RESTRICT`. They still read party data through its
contracts.

## Entry points

| Import                        | Holds                                                                                    | May import                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pixel-scientists/party/contracts` | Data and route contracts and events, safe for the browser                                | `zod`, `@pixel-scientists/domain`, other modules' contracts                                                                                              |
| `@pixel-scientists/party/server`    | Routes and services. `src/server/index.ts` is the in-process contract other modules call | Its own contracts, `@pixel-scientists/db` and the generated types for the `party` schema only, `@pixel-scientists/domain`, other modules' contracts and server |
| `@pixel-scientists/party/console`   | Staff and reviewer screens                                                               | Its own contracts, other modules' contracts, `@pixel-scientists/ui`, `@pixel-scientists/domain`, React                                                         |
| `@pixel-scientists/party/portal`    | Applicant screens                                                                        | Its own contracts, other modules' contracts, `@pixel-scientists/ui`, `@pixel-scientists/domain`, React                                                         |

`eslint.config.js` enforces these rules, so `pnpm check` fails on any other
import, whether static, dynamic or through `require()`, and on a relative
path that leaves the entry point or its module's contracts. Code outside the
four entry point folders fails too. Tests are exempt. The apps may import
any entry point.

A feature that crosses modules starts with a contract change, landed before
the code that uses it.
