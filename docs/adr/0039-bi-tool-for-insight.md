# ADR 0039: BI tool for insight starter dashboards

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

The first release of `insight` promises starter dashboards in an open source
BI tool, and the suite roadmap leaves the choice open between Metabase and
Apache Superset. The roadmap's list of ADRs has no entry for that choice;
this ADR fills the gap.

What the tool sits on is already decided:

- [ADR 0016](0016-modular-suite-and-shared-warehouse.md) gives each tenant
  one conformed warehouse model (`organisation`, `person`, `programme`,
  `commitment`, `payment`, `date`, plus `<module>_<subject>` tables). Each
  module's contribution feeds it, filtered by classification: personal
  columns are left out by default and special category columns never go in.
  MVP1 delivers it as a PostgreSQL load script that a tenant admin downloads
  ([the snapshot guide](../self-hosting/warehouse-snapshot.md)), audited as
  `platform.warehouse.exported`. Application tables are never replicated,
  and a warehouse download is an export.
- The module data contracts that dashboards are written against are
  versioned, and the snapshot names its model version in its header.
- [ADR 0002](0002-licence-and-dependency-policy.md): a service run as a
  separate container is not linked. It needs an OSI-approved licence, is
  listed in the SBOM, is not held to the licence table, and its image is
  pinned by digest.
- [ADR 0024](0024-no-tool-on-by-default.md): nothing is on until someone
  chooses it.
- [ADR 0010](0010-authentication-security-rules.md) sets the bar for sign-in
  to anything that holds tenant data.
- [ADR 0027](0027-erasure-across-modules-and-audit.md) and
  [ADR 0032](0032-equality-and-monitoring-data.md): erased people must not
  outlive a copy's retention, and equality and monitoring data never enter
  the warehouse. Fair-funding reports stay in the app, behind disclosure
  control.
- ADR 0012 (hosting targets and cells, being drafted) pins each tenant to
  one cell and keeps cloud specifics under `infra/terraform/`. Hosting
  phase 1 is the managed service in `europe-west2`.
- Nothing is feature-gated. Self-hosters get exactly the BI features the
  managed service runs, so a feature we need that exists only in a paid
  tier rules the tool out.

The BI tool sits outside the app's row-level security
([rule 2](../ARCHITECTURE.md)). Whatever we choose, isolation has to come
from databases, credentials and networks, not from a filter inside the tool.

## Options considered

Tool:

1. **Metabase, open source edition.** AGPL-3.0, released every few weeks,
   simple to use, and runs as one JVM process. Its repository also holds
   enterprise code under a commercial licence; the open source image
   (`metabase/metabase`) leaves that code out. The features we need are
   among those the vendor puts in its paid tiers:
   - sign-in through SAML or JWT (the open source edition offers Google
     sign-in and LDAP);
   - serialisation, which exports and imports dashboards as files;
   - data sandboxing.

   Without serialisation, starter dashboards cannot be versioned files in
   the repository (rule 10). Without SSO, sign-in would be through local
   passwords that we cannot hold to ADR 0010. Shipping the paid tier to
   the managed service only would gate features. Rejected.
2. **Apache Superset.** Apache-2.0, an Apache Software Foundation top-level
   project with a large contributor base, several releases a year, and
   advisories published through the ASF security process. Everything we
   need is in the one open source release:
   - OIDC sign-in through Flask-AppBuilder's OAuth support, with roles
     mapped from the identity provider's groups;
   - dashboards exported and imported as YAML bundles, by command line or
     API, keyed by stable UUIDs;
   - per-database access control and read-only connections (DML off per
     database);
   - its metadata in PostgreSQL.

   Commercial hosted Superset is a separate company's service. Nothing of
   it is in the ASF repository or image. Its drawbacks: Superset is heavier
   to configure (a Python config file, many feature flags), it runs
   several gunicorn workers, and its viewer has accessibility gaps (below).
3. **No BI tool: dashboards built into the console.** No new service, but
   it means building a charting and query product inside the app, and a
   query layer that reads warehouse data rather than application tables.
   That is far beyond `insight` v1, and funders' data teams want a tool they
   already know. Fair-funding reports stay in the app anyway (ADR 0032).

Compared on what we need:

| Need | Metabase open source | Apache Superset |
| --- | --- | --- |
| Licence of the image | AGPL-3.0 (enterprise code under a commercial licence in the same repository) | Apache-2.0 |
| OIDC or SAML sign-in | Paid tiers | Open source (OIDC) |
| Dashboards as files | Paid tiers (serialisation) | Open source (export and import) |
| Read-only connections | Yes, by database role | Yes, by role, plus DML off per database |
| Per-tenant data isolation in the tool | Paid tiers (sandboxing) | Row filters in open source; not used as the boundary either way |
| Metadata database | PostgreSQL | PostgreSQL |
| Memory | One JVM, about 1 to 2 GB | Gunicorn workers, about 1 to 2 GB |
| Accessibility of the viewer | Gaps in charts and keyboard use | Gaps in charts, the dashboard grid and filters |

Isolation between tenants:

4. **One BI instance per tenant.** Each tenant gets its own Superset
   process, metadata database, secret key, OIDC client and warehouse
   database. Users, roles, saved queries and connections can never mix,
   and each instance signs in against its own tenant's identity provider.
   Costs about 1 to 2 GB of memory per tenant that turns the service on.
5. **One BI instance per cell, with a warehouse database and connection per
   tenant.** Cheaper, but every tenant's users share one metadata database,
   and Superset's own permission model decides which connection each user
   sees. That is an in-tool boundary. It also needs several identity
   providers in one instance, which Flask-AppBuilder handles poorly.

## Decision

**Apache Superset (option 2), one instance per tenant (option 4)**, run as
an optional service that reads only a warehouse loaded from that tenant's
snapshot.

### Licence and image (ADR 0002 record)

- Licence: `Apache-2.0`, from the ASF repository `apache/superset`. The
  image is the project's official `apache/superset` release image, at the
  latest stable release when it is pinned. Nothing under another licence is
  run, and no commercial or hosted variant is used.
- It runs as separate containers (web server, and an init job for
  migrations and dashboard import), and talks to us only over HTTP and the
  PostgreSQL wire protocol. It is not linked to our code, and the AGPL-3.0
  platform imports nothing from it.
- The image is pinned by digest. If the release image lacks the PostgreSQL
  driver, S12-29 builds one thin image from that digest that adds only the
  driver at a pinned version and hash, and pins the result. Syft lists the
  image's packages in the release SBOM.
- No npm package is added, and `licence-policy.json` and the lockfile do not
  change.

### Optional service

- In Compose, the BI tool is an overlay, `infra/compose/compose.bi.yaml`,
  used with `compose.stack.yaml`. In Helm it is a sub-chart,
  `infra/helm/charts/bi/`, with `enabled: false` by default that renders
  nothing when off. The starter dashboards, the load and import scripts,
  the Superset config and the read-only role SQL go in `infra/bi/`. S12-29
  owns these three paths. The same images run in both.
- No API, worker or web service depends on it, and `pnpm dev` and
  `pnpm stack` behave the same without it. An operator turns it on per
  tenant; nothing turns it on by default (ADR 0024).
- Features that send data out or run unattended stay off: alerts and
  reports, embedded dashboards and guest tokens, CSV and file upload into
  databases, and the public role (it has no permissions). Only the operator's
  provisioning step creates database connections; no role in the tool can
  add, edit or test one, which also stops the tool being used to probe
  other hosts.

### What it reads

- Each tenant has two databases of its own on a **BI PostgreSQL server**:
  - a **warehouse database**, loaded from that tenant's snapshot;
  - a **metadata database**, for Superset's users, roles, saved queries and
    dashboards.

  Each has its own role and password. The server runs PostgreSQL 16 or
  later, from the same image family as the stack's, and is a separate
  server from the application's, never a database on it.
- Superset's data connection uses a read-only role with `CONNECT` on the
  tenant's warehouse database, `USAGE` on its schema and `SELECT` on its
  warehouse tables, and nothing else: no `CREATE`, no other schema, no
  membership of `pg_read_all_data`, `pg_read_server_files` or any other
  predefined role, not superuser. `CONNECT` on every BI database is
  revoked from `PUBLIC`. `dblink` and `postgres_fdw` are not installed on
  the BI server, so no connection can reach outside its own database. DML is
  off on the connection in Superset as well, as a second guard.
- **Network rule.** No BI container or pod has a route to the application's
  PostgreSQL server, its network or its roles. Specifically:
  - In Compose, the BI services join their own `internal: true` network,
    which holds only the BI tool, its init job and the BI PostgreSQL
    server. They never join `database`, `files`, `scan` or `web`. The tool
    is published on 127.0.0.1 only, for the reverse proxy.
  - In Helm, every BI pod is default-deny for ingress and egress. The tool
    may reach DNS, the BI PostgreSQL server on TCP 5432 and, for sign-in,
    the tenant's identity provider on TCP 443 at public addresses. It may
    never reach link-local, private or loopback ranges (`169.254.0.0/16`,
    `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`,
    `127.0.0.0/8`, `fc00::/7`, `fe80::/10`, `::1/128`), other than the BI
    PostgreSQL server. The BI PostgreSQL server accepts connections only
    from BI pods. Ingress to the tool comes only from the reverse proxy.
  - The test, in Compose and in a kind cluster: from inside the BI tool's
    container, a TCP connection to the application's PostgreSQL on 5432
    and to `169.254.169.254:80` fails, and one to the tenant's warehouse
    database succeeds. A second tenant's read-only role and password,
    used from the first tenant's instance, are refused by the second
    tenant's warehouse database.

### Isolation between tenants

Option 4: one instance per tenant. One tenant's users, dashboards and saved
queries live in a different process and metadata database from another's,
with a different secret key and OIDC client. Each instance holds the
credentials for one warehouse database only. PostgreSQL's authentication and
per-database `CONNECT` are the boundary; row-level filters in Superset are
never used for isolation. On a self-hosted install with one tenant this is
simply one instance.

### Sign-in

- The tool signs in only through OIDC, against the tenant's own identity
  provider. Local password sign-in is off, and there is no default or
  shared admin account. The identity provider enforces MFA, so a tenant
  without an OIDC provider that enforces MFA cannot have the BI service in
  v1.
- Superset roles come from the identity provider's groups and are synced at
  every sign-in. A user with no mapped group gets no role and sees nothing.
  The tenant names a group for BI admins (Superset's admin role) and one
  for viewers; the first admin comes from that mapping, not from a created
  account.
- The tool is served on its own host name per tenant, never on the
  console's or portal's host. Its cookies are host-only, `Secure`,
  `HttpOnly` and `SameSite=Lax`, under a secret key of its own, read from a
  secret file. It never shares PixelGrant's sessions, cookies, auth secret
  or OIDC client. CSRF protection and Superset's security headers are on.
- Sessions end 12 hours after sign-in (ADR 0010's absolute timeout for
  staff). Superset has no idle timeout of its own; the identity provider's
  session governs re-sign-in.
- When a member leaves, removing them from the identity provider (or its BI
  groups) stops their next sign-in and drops their roles. An open session
  ends within 12 hours, or at once if the operator deactivates the user in
  the tool, which the operator runbook in S12-29 covers.
- Every page except the health check needs sign-in.

### Where it runs

The BI tool, the BI PostgreSQL server and the tenant's two BI databases run
in the tenant's cell (ADR 0012, being drafted). On the managed service in
hosting phase 1, that is `europe-west2`. The BI PostgreSQL server is a
separate instance from the application's, and its cloud specifics live only
under `infra/terraform/`. Superset and PostgreSQL run on any host, so
hosting phases 2 and 3 move them with the cell.

### Starter dashboards

- Starter dashboards are Superset export bundles under
  `infra/bi/dashboards/`, each stating the data contract version it
  targets. The init job imports them on install and upgrade, by UUID. It
  refuses to import a bundle whose contract version does not match the
  model version recorded from the loaded snapshot's header.
- Starter dashboards belong to the release: an upgrade overwrites them. A
  tenant who wants a change saves a copy, and copies, along with the
  tenant's own charts, dashboards and saved queries, survive upgrades
  untouched. The import never deletes anything it did not create.
- A dashboard references only tables and columns its data contract
  publishes, and S12-29 checks this in CI.

### Delivery in v1: snapshot only

- Data reaches the tool only through ADR 0016's snapshot. A tenant admin
  downloads it (audited by the snapshot route), and an operator loads it
  into the tenant's warehouse database with the load script in `infra/bi/`.
  On the managed service, the admin passes the file over the support
  channel's secure transfer. The script drops and recreates the warehouse
  tables and loads them in one transaction with `ON_ERROR_STOP`, as the
  warehouse owner role, never the read-only role. It records the snapshot's
  creation time and model version, and the operator records the load in
  the cell's operations log.
- Loading replaces the whole warehouse. Nothing is appended or merged, so
  people erased since the last snapshot disappear on the next load
  (ADR 0027).
- A loaded warehouse may be at most 30 days old, counted from the
  snapshot's creation time: the operator reloads it or empties it before
  then. Dashboards show the snapshot time, so viewers know how stale the
  data is.
- The loaded warehouse is an export: classified as its most sensitive
  column, which in v1 is internal, since personal columns are left out.
- Scheduled snapshots, the incremental feed, the BigQuery load and the
  per-tenant personal data opt-in stay in `insight` v1.1. The opt-in in
  particular needs its own decision on how erasure reaches a loaded
  warehouse before the BI tool may see personal columns.
- This ADR adds a consumer of the snapshot and an operator step to load it;
  it does not change ADR 0016's delivery section.

### Equality and monitoring data

Special category and equality monitoring data never reach the BI tool: the
warehouse filter refuses them (ADR 0032), and no dashboard reads anything
but the loaded warehouse. Fair-funding reports stay in the app, with
disclosure control.

## Consequences

- Rule 1, portable: Superset and the BI server run on vanilla PostgreSQL 16
  or later in Docker, with no cloud-only feature. The warehouse is plain
  SQL, so a tenant can point another tool at it, and we can swap Superset
  for another tool without changing the warehouse.
- Rule 2, tenant isolation: the tool sits outside the app's row-level
  security, so tenants are kept apart by separate instances, separate
  warehouse databases and per-database credentials, and the tool is kept
  from the application by the network rule above.
- Rule 5, classification: the tool sees only columns that passed ADR 0016's
  classification filter, so only public and internal columns in v1.
- Rule 9, humans decide: dashboards inform. Nothing in the BI service
  rejects, awards or pays, and the read-only role and DML switch mean
  nothing writes back to any database.
- Rule 10, versioned configuration: starter dashboards are versioned files
  in the repository, tied to a data contract version.
- The metadata database holds users' names and email addresses (personal)
  and dashboard and query definitions (internal). It is backed up under
  ADR 0011 (backups and restore, being drafted), at the same tiers as the
  application database. The warehouse database is not backed up: it is a
  copy that is reloaded, and restoring an old one would bring back erased
  people.
- When a tenant leaves, or turns the service off, the operator deletes its
  BI instance, its metadata and warehouse databases, their roles, and the
  secret key and OIDC client secret. Backups of the metadata database
  expire on their tiers.
- Memory and cost grow by about 1 to 2 GB per tenant that turns the service
  on. That is acceptable while it is optional and sold with `insight`.
  Turning it on is an operator action.
- Accessibility: the viewer is expected to have gaps (chart content drawn
  on a canvas with no text alternative, keyboard use of the dashboard grid
  and filter bar, and the contrast of some default colour schemes). S12-29
  checks the viewer and adds each gap it finds to the
  [known-issues register](../accessibility/known-issues.md). Each chart's
  data stays readable as a table. Dashboard text follows the content
  style, and charts that carry meaning by colour also label their values.
- A tenant without an OIDC provider that enforces MFA cannot have the
  service in v1. If funders ask for it, a later ADR may make the platform
  itself an OIDC provider for the BI tool, which would still share no
  session or cookie with it.
- One process per tenant means one more thing to upgrade per tenant. The
  Helm sub-chart and the init job's idempotent import keep that to a
  values change and a rollout.
- Superset's own advisories become ours to track: the image pin is updated
  with each security release, like the stack's other images.

## Dependency check

No npm package is added, and `licence-policy.json` and the lockfile do not
change. The service is a container under ADR 0002's rule for services.

| Tool | Licence | Image | Maintenance | Notes |
| --- | --- | --- | --- | --- |
| Apache Superset (chosen) | Apache-2.0 | `apache/superset`, pinned by digest | ASF top-level project; several releases a year; many contributors; advisories published as CVEs through the ASF | Every feature we need is in the open source release |
| Metabase open source (not chosen) | AGPL-3.0; enterprise code in the same repository under a commercial licence | `metabase/metabase` | Commercially backed; releases every few weeks; advisories published on GitHub | SSO, serialisation and sandboxing are in the paid tiers |

Sources:

- Superset licence: <https://github.com/apache/superset/blob/master/LICENSE.txt>
- Superset configuration, OAuth and roles:
  <https://superset.apache.org/docs/configuration/configuring-superset>
- Superset security and advisories: <https://superset.apache.org/docs/security/>
- Metabase licence: <https://www.metabase.com/license>
- Metabase features by plan: <https://www.metabase.com/pricing>
- Metabase serialisation:
  <https://www.metabase.com/docs/latest/installation-and-operation/serialization>

S12-29 re-reads these pages when it pins the image. It records the release,
digest, release date and the advisories of the previous 12 months in its
pull request, as ADR 0002 asks of any dependency.
