# ADR 0012: Hosting targets and cells

- **Status:** proposed
- **Date:** 2026-11-08
- **Deciders:** Aaron Gardner

## Context

The managed service starts on Google Cloud in London. Funders in other
jurisdictions, and funders who want no US-owned supplier at all, need other
options later. The cost of those options must not be paid now, and nothing
built now may rule them out.

Constraints:

- [Architecture rule 1](../ARCHITECTURE.md): everything runs on vanilla
  PostgreSQL 16 or later, and cloud specifics live only in `infra/terraform/`.
- [Architecture rule 2](../ARCHITECTURE.md) and
  [ADR 0003](0003-query-builder-and-migrations.md) need a roles model that a
  managed PostgreSQL service does not fully allow, since it gives no true
  superuser.
- Data protection law and funders' contracts care where data sits and who can
  be compelled to hand it over.
- Modules share one warehouse and one deployment
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)).

## Options considered

How to serve more than one jurisdiction:

1. **One global deployment, with each tenant's data routed to a region.** One
   thing to run, but every tenant shares one control plane, one set of
   operators and one failure, and a mistake crosses a border.
2. **One deployment per jurisdiction, a "cell", with each tenant pinned to
   one.** The boundary is a deployment, so it is simple to state and hard to
   break. The cost is running several copies.
3. **Cells that replicate to each other.** Easy tenant moves, but personal data
   crosses the jurisdiction boundary continuously.

When to go sovereign:

4. **Sovereign hosting from day one.** Fewer managed services and a slower
   start, for a need no customer has yet.
5. **In phases, building only the first and keeping the others open.**

## Decision

Options 2 and 5.

### Hosting phases

| Phase     | Runs on                                                        | Backup                                                                                           |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 (now)   | Google Cloud UK (`europe-west2`)                               | A UK-sovereign provider receives full daily snapshots ([ADR 0011](0011-backups-and-recovery.md)) |
| 2 (later) | Google Cloud EU                                                | An EU-sovereign provider                                                                         |
| 3 (later) | A fully UK or EU data-sovereign package on two sovereign hosts | The second sovereign host                                                                        |

V1 builds only phase 1. Research into EU and sovereign hosting providers waits
for phase 2.

### Cells

- A cell is a complete, separate deployment in one jurisdiction. The first is
  `uk`.
- A tenant is pinned to one cell at onboarding. Its database, files, backups,
  logs, email relay and telemetry all stay in that jurisdiction.
- Each cell runs every module. Cells share no data and no database.
- Resource names and labels carry the environment and cell, in brand-neutral
  form (`tps-<environment>-<cell>-…`).

### Sovereign

"Sovereign" means owned, operated and governed within the jurisdiction, with no
parent subject to foreign disclosure laws such as the US CLOUD Act. Google
Cloud in London meets a residency requirement but is not sovereign in this
sense, which is why phase 1 keeps a full off-site copy with a provider that is.

### What any target must provide

- PostgreSQL 16 or later with row-level security, logical replication and the
  roles model in ADR 0003, reachable over TLS that passes `verify-full`.
- A way for the backup role to read every row. On a managed PostgreSQL service
  that means the roles script's managed mode passes (ADR 0011).
- S3-compatible storage with object lock.
- Containers.
- Key management and secrets.
- An in-jurisdiction SMTP relay and an OpenTelemetry backend.
- ISO 27001 and Cyber Essentials Plus, or an EU equivalent.

### What differs per target

- The warehouse feed: BigQuery on Google Cloud, and logical replication to the
  funder's warehouse elsewhere.
- Secrets: each target's own store.
- Email and telemetry backends: each target's own, in the jurisdiction.

The application stays identical. Connection details reach it only through its
existing `TPS_` settings.

### Infrastructure code

- Reusable modules sit under `infra/terraform/modules/`, named for their
  target, such as `gcp-network`. Roots such as `infra/terraform/gcp/network/`
  take `environment` and `cell` inputs, so production reuses them.
- No provider-neutral module is written until a second target needs one.
  Guessing its shape from one provider would produce the wrong abstraction.

### Managed PostgreSQL

- The roles script's managed mode is the bridge to managed PostgreSQL. It runs
  as the provider's admin role, and sets what that role may set. It then
  checks every role against ADR 0003, and fails if anything differs.
- IAM database authentication covers human operators only in V1. The app roles
  keep ADR 0003's SCRAM passwords, set by the roles script.
- The apps connect with standard PostgreSQL TLS. There is no Cloud SQL Auth
  Proxy or language connector, so the same code runs on any provider.

### Moving a tenant

A tenant moves between cells by export and import, following a runbook, and
never by replication. A funder with a custom domain changes its DNS as part of
the move ([ADR 0035](0035-embeds-and-custom-domains.md)). Backups in the old
cell expire on their own tiers.

### What waits for staging

No Google project exists yet, so the first cell is a design and not yet a
deployment. Staging will show:

- that Cloud SQL meets the list above, including the backup role's exemption;
- which Cloud SQL certificate mode lets `verify-full` pass its host name check;
- that the network and database come up from code alone.

## Consequences

- Each new jurisdiction means running another full deployment, including its
  monitoring and backups. We accept that cost in exchange for a boundary that
  is easy to explain and audit.
- Cross-tenant reporting across cells is not possible without a separate,
  deliberate export.
- Moving a tenant takes planned downtime for that tenant.
- Choosing a provider for phase 2 or 3 is a matter of checking it against the
  list above, and a provider that fails it is ruled out.
- A managed PostgreSQL service that cannot give the backup role its exemption
  fails that list, and Cloud SQL itself is still to be proven against it.

## Dependency check

No dependency is added.
