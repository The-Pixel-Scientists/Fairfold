# ADR 0016: Modular suite and shared warehouse

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

On 2 October 2026 Aaron set out PixelGrant as the first module of a suite of
tools for foundations, sharing one warehouse:

- grants, the V1 scope;
- a bespoke CRM, whose party core (organisations, people, relationships and
  consent) arrives in MVP1 as the master record every module uses
  ([ADR 0017](0017-bespoke-crm-party-core.md));
- direct charitable activities (DCA): work a foundation runs itself, in the
  charity SORP sense, such as projects, partners, contracts, milestones and
  outcomes;
- a finance integrator for payments out, donations and other income in, and
  receivables, with connectors to accounting and payment systems.

Each tool will carry its own brand under a parent brand. The names wait for
a trademark check, so code and docs use working names: `grants`, `party`,
`crm`, `dca`, `finance`.

Constraints:

- The [architecture rules](../ARCHITECTURE.md) apply to every module
  unchanged, including row-level security as set out in
  [ADR 0003](0003-query-builder-and-migrations.md).
- One container stack that self-hosters run whole
  ([ADR 0005](0005-dev-topology.md)).
- Nothing is feature-gated.
- Logical replication ignores row-level security, so tenant tables are never
  published directly (ADR 0003).
- One maintainer: the design has to stay small.

## Options considered

Structure:

1. **One application with no internal boundaries.** Least ceremony now, but
   CRM, DCA and finance code would read and write grants tables, nothing
   could be switched off per tenant, and the coupling would be costly to
   undo.
2. **A modular monolith in one repository.** Each module owns a schema and
   its code, and reaches other modules only through published contracts and
   events; one deployable and one database. Boundaries are kept by lint,
   generated types and package manifests rather than by the database.
3. **A service, database and repository per module.** Hard boundaries, but
   auth, row-level security, backups, migrations, CI and releases multiply,
   self-hosting gets heavier, and changes across modules need distributed
   transactions.

Events between modules:

4. **pg-boss jobs sent inside the publisher's transaction**, through the send
   helper in [ADR 0009](0009-background-jobs.md). The job table acts as the
   outbox; its exception to rule 2 and the guards already exist.
5. **An outbox table and a relay.** An ordered, durable event log, and one
   more table and process before anything needs them.
6. **LISTEN and NOTIFY.** Lost on restart.

Warehouse feed:

7. **Replicate application tables** by logical replication or Datastream.
   Bypasses row-level security and classification; Datastream is Google
   only.
8. **A conformed model fed by every module, filtered by classification,**
   with delivery methods that can change without changing the model.

## Decision

Option 2, with events by option 4 and the warehouse by option 8.

### Modules

| Module | Schemas | Owns | Per tenant |
| --- | --- | --- | --- |
| Platform | `app`, `auth` | Tenants, memberships, roles, accounts and sessions, audit, configuration versions, theme, module settings, the warehouse feed | Always on |
| Party | `party` | Organisations, people, relationships, consent | Always on |
| Grants | `grants` | Programmes through to released decisions | Switchable, on by default |
| CRM, DCA, finance (after MVP1) | `crm`, `dca`, `finance` | Interactions and pipelines; projects, partners, contracts, milestones and outcomes; payments, income and receivables | Switchable |

### Repository layout

One repository:

- `apps/`: the deployables (API, console, portal). They hold the platform's
  own server code and screens, and compose the modules.
- `packages/`: the platform packages (`domain`, `db`, `ui`, `config`). Shared
  engines that more than one module needs, such as the form engine, live in
  `packages/domain`.
- `modules/<module>/`: one folder per tool, with its own `README.md`,
  `docs/`, `CHANGELOG.md` and release tags (`grants-v0.1.0`). It is one
  workspace package with four entry points:
  - `contracts`: data and route contracts and events, safe for the browser;
  - `server`: routes and services; its `index.ts` is the module's in-process
    contract for other modules;
  - `console` and `portal`: the module's screens.
- Every module's database work stays in `packages/db`: its migrations, its
  classification file and its generated types. One migration sequence, one
  runner and one catalogue test then cover every schema, and the
  classification map stays where rule 5 names it.

A module imports only the platform packages and other modules' published
contracts: `@pixelgrant/<module>/contracts` from anywhere, and
`@pixelgrant/<module>/server` from server code only. Lint rules enforce this
per entry point, and each module's database types are generated per schema,
so a query on another module's tables does not compile.

A module moves to its own repository only when it has its own maintainers,
its own contributor community, or a release rhythm the shared repository
holds back, and its contracts have had no breaking change for at least one
release. The move needs its own ADR, because the module's migrations would
then need their own history.

### Database

- A module changes only its own schemas. Migration folders are named
  `NNNN_<schema>_<description>`, the runner refuses a schema it does not
  know, and numbers follow merge order across all modules.
- Every module table is a tenant table under ADR 0003, set up with
  `app.enable_tenant_rls()`. The catalogue test already covers every
  application schema.
- Classification lives in one file per schema, and
  `packages/db/classification.ts` merges them.
- A foreign key may cross modules only to a key the target module publishes:
  `app.tenant`, `app.membership`, and `party.party`, `party.organisation`,
  `party.person` and, once it lands, `party.organisation_snapshot`
  ([ADR 0017](0017-bespoke-crm-party-core.md)). It includes
  `tenant_id` and is `ON DELETE RESTRICT`. It gives integrity, not access:
  the referencing module still reads through the contract.

### Calls and events

- One API request is one tenant transaction. A module calls another through
  `@pixelgrant/<module>/server` inside that transaction, so the whole request
  commits or rolls back together.
- An event is a versioned, past-tense fact such as
  `grants.decision_released.v1`. Its Zod schema is in the publisher's
  contracts, and its payload follows ADR 0009: ids, enums, integers and
  timestamps only.
- Publishing sends one pg-boss job per subscribing module, through ADR 0009's
  send helper in the publisher's transaction, so the event exists only if
  the change commits. Subscriptions are declared in code; each subscribing
  module has one queue, created in a migration.
- Handlers are idempotent, run in the event's tenant through ADR 0009's
  wrapper, and read current state through the owner's contract rather than
  trusting the payload.
- Events live as long as jobs (7 days) and are not a history. Anything that
  must be kept lives in module tables or the audit log, and rebuilds read
  current state.
- MVP1 has no subscribers. If we later need ordered replay, or delivery
  outside the process such as webhooks, a new ADR adds an outbox table.

### Names and shared types

- Permissions, audit actions and events start with their module's name:
  `grants.decisions.release`, `grants.decision.released` and
  `grants.decision_released.v1`. Two modules can then never claim the same
  name, and a tenant's audit log reads by module.
- Roles are bundles of permissions held as data in `packages/domain`. Code
  checks permissions, never role names, so a later module adds permissions
  without touching any handler.
- Money is an integer amount in minor units with an ISO 4217 currency code,
  in every contract, table, export and warehouse column. MVP1 accepts GBP
  only.

### Switching modules on and off

- `app.tenant_module` records which switchable modules a tenant uses. A
  tenant admin changes it; each change is a configuration version (rule 10)
  and an audit event.
- When a module is off for a tenant, its routes answer 404, its screens are
  hidden and its event handlers skip that tenant. Its data stays, and
  returns when the module is switched on again; only retention rules delete
  data.
- Every deployment ships and migrates every module. No edition, plan,
  licence key or price check exists anywhere in the code. A switch exists
  because funders work differently, never to sell access.

### Shared warehouse

- One conformed model per tenant, defined in `packages/domain`:
  - shared tables: `organisation`, `person`, `programme` (a programme of
    grants or of activity), `commitment` (money promised, such as an award
    or a contract), `payment` and `date`. "Fund" is left for restricted,
    unrestricted and endowment funds in the charity SORP sense, which
    finance will bring into the same warehouse;
  - module tables named `<module>_<subject>`, such as `grants_application`
    and `grants_score`.
- `organisation` and `person` come only from the party module, so every
  module's rows join to the same organisations and people. Other shared
  tables take rows from any module, with a `source_module` column, keyed by
  the source row's id.
- Every module feeds the warehouse the same way: its server contract exports
  one contribution that yields rows for the tables it feeds. Every warehouse
  column names its source column and takes that column's classification:
  - public and internal: included;
  - personal: left out unless the tenant switches on personal data in its
    warehouse, which is off by default and comes after MVP1;
  - special category: never.

  A test fails if a warehouse column has no classified source.
- MVP1 delivers a snapshot on demand. A tenant admin downloads one PostgreSQL
  load script for their tenant (`CREATE TABLE` statements and `COPY` data),
  which loads into any PostgreSQL 16 or later with `psql`. It is built inside
  the admin's request, under their session and permissions, and audited.
  Values are escaped for `COPY`'s text format, and a test shows that no value
  can end the data block and run as SQL.
- Later delivery methods use the same contributions and filter: scheduled
  snapshots to S3-compatible storage, an incremental feed driven by events,
  and on the managed service a BigQuery load configured only in
  `infra/terraform/`. Application tables are never replicated to a
  warehouse.
- A warehouse download is an export: classified as its most sensitive
  column, and reviewed line by line as security-critical.

Nothing here needs more than PostgreSQL 16 and Node.js, and each deployment
("cell") runs every module, so later hosting phases are unaffected.

## Consequences

- CRM, DCA and finance can arrive without changing grants tables, and a
  tenant can use any combination of modules.
- A feature that crosses modules starts with a contract change, landed before
  the code that uses it.
- Boundaries rest on lint, manifests, generated types and review, not on
  database roles: every module runs as the same app roles. Raw SQL that
  names another schema is caught by ADR 0003's Semgrep rules and by review.
- Code ownership gains a row per module entry point, and the ownership hook
  learns the `modules/` paths before the first module code lands. Existing
  code does not move: everything built so far is platform code.
- `pnpm db:types` writes one types file per schema.
- Code identifiers never carry a product brand, the package scope included
  (ADR 0021), so a rebrand changes only user-facing text and docs. Modules
  keep their working names in code.
- [ADR 0008](0008-standalone-or-twenty.md)'s choice to build standalone
  stands; ADR 0017 replaces its "CRM later, possibly Twenty" stance.

## Dependency check

No dependency is added.
