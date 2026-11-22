# CRM

CRM is for relationships, interactions and consent with the organisations and
people you work with. Its staff screens are not yet available. See the
[CRM README](../../../modules/crm/README.md). No guide has merged, so this
page is written from the code and the classification map as they stand on
19 November 2026.

## Personal data it holds

The classification map lists 8 `crm` tables, 3 with personal data and 5
internal: imports (jobs and rows), interactions, lists and their members,
segments, external references and merge records. They fall under the party
records purpose. The proposed lawful bases are legal obligation and
legitimate interests. No special category data is classified here.

The tables exist in the schema, but the server registers no routes and there
are no screens. Nothing in the application writes to them. The module switch
keeps the tool off for every tenant until an administrator switches it on
([ADR 0024](../../adr/0024-no-tool-on-by-default.md), still proposed).

## Controls beyond the platform baseline

- The module builds on party records, which stay the master record
  ([ADR 0017](../../adr/0017-bespoke-crm-party-core.md), still proposed).
- Import rows have a short fixed retention in the map.
- Erasure and merge behaviour have database tests: `packages/db/test/crm/`.

## Row-level security and audit

- Each table has a cross-tenant denial test:
  `packages/db/test/crm/cross-tenant.test.ts`.
- Audit action names are published in the module's contracts and tested in
  `modules/crm/src/contracts/audit.test.ts`. No events are written yet.

## Open items

- Server routes, staff screens and a guide: not yet available.
- Audit coverage of real actions: not yet available.
