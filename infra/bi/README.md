# BI service for Fairfold Reporting

An optional Apache Superset instance for one funder, with starter dashboards,
reading only a warehouse loaded from that funder's
[warehouse snapshot](../../docs/self-hosting/warehouse-snapshot.md). It is off
unless you turn it on ([ADR 0039](../../docs/adr/0039-bi-tool-for-insight.md)).
This page is for operators.

Each funder that uses it gets its own Superset instance, secret key and OIDC
client, and two databases of its own on a BI PostgreSQL server: a warehouse and
Superset's metadata. The BI server is never the application's PostgreSQL
server, and no BI container can reach the application's database or networks.

## Before you start

- The funder's identity provider must support OIDC and enforce multi-factor
  sign-in. Superset has no passwords of its own and no admin account: the
  provider's groups decide who is an admin and who may view.
- Give the tool its own host name, never the console's or the portal's, and
  serve it over HTTPS through your reverse proxy.
- Choose a BI key for the funder: a lower-case letter, then up to 29
  lower-case letters or digits. It names the funder's databases and roles,
  which every role on the BI server can see, so use an opaque key, not the
  funder's name.
- Register an OIDC client at the provider with the redirect URL
  `https://<BI host>/oauth-authorized/oidc`.

## Settings

Set these in the environment that runs `docker compose`. Secrets are copied
into the containers that use them as files under `/run/secrets` and nowhere
else. Make each with, for example, `openssl rand -hex 32`, keep it in a file
only you can read, and export it from that file.

| Variable                    | What it is                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `TPS_BI_TENANT`             | The funder's BI key                                                                 |
| `TPS_BI_TENANT_ID`          | The funder's tenant id, from your records; loading refuses a snapshot for any other |
| `TPS_BI_PORT`               | The port on 127.0.0.1 your reverse proxy reaches the tool on                        |
| `TPS_BI_OIDC_ISSUER`        | The provider's issuer URL                                                           |
| `TPS_BI_OIDC_CLIENT_ID`     | The OIDC client's id                                                                |
| `TPS_BI_OIDC_GROUPS_CLAIM`  | The claim that lists the user's groups (default `groups`)                           |
| `TPS_BI_ADMIN_GROUP`        | The group whose members are BI admins                                               |
| `TPS_BI_VIEWER_GROUP`       | The group whose members may view dashboards and build their own                     |
| `TPS_BI_POSTGRES_PASSWORD`  | Secret: the BI server's superuser                                                   |
| `TPS_BI_OWNER_PASSWORD`     | Secret: the role that loads the warehouse                                           |
| `TPS_BI_READER_PASSWORD`    | Secret: Superset's read-only warehouse role                                         |
| `TPS_BI_SUPERSET_PASSWORD`  | Secret: Superset's metadata role                                                    |
| `TPS_BI_SECRET_KEY`         | Secret: Superset's own secret key, never the platform's                             |
| `TPS_BI_OIDC_CLIENT_SECRET` | Secret: the OIDC client's secret                                                    |

A member of neither group can sign in but sees nothing.

## Start it

```sh
docker compose -f infra/compose/compose.stack.yaml -f infra/compose/compose.bi.yaml up --detach --wait
```

The overlay shares nothing with the stack, so it also runs on its own with
`-f infra/compose/compose.bi.yaml` alone. The first start creates the funder's
databases and roles and Superset's tables. No dashboards appear until a
snapshot is loaded.

Put the tool behind your reverse proxy: a server block for the BI host name
with your certificate and HSTS, passing everything to
`http://127.0.0.1:<TPS_BI_PORT>` with the `Host`, `X-Forwarded-For` and
`X-Forwarded-Proto` headers set. Only `/health` answers without sign-in.

## Load a snapshot

A funder admin downloads the snapshot (it is recorded in the audit log) and
passes it to you over the support channel's secure transfer. Do not open and
save it in an editor: loading refuses a file that differs in any way from what
the platform wrote.

```sh
docker compose -f infra/compose/compose.bi.yaml run --rm --no-TTY bi-load - < northfield-warehouse-snapshot.sql
docker compose -f infra/compose/compose.bi.yaml run --rm bi-init
```

The first command replaces the whole warehouse in one transaction, so people
erased since the last snapshot are gone. It refuses a snapshot for another
funder or one more than 30 days old. The second imports the starter dashboards
for the snapshot's model version. Record each load in the cell's operations
log.

Reload or empty the warehouse within 30 days of the snapshot's date: every
dashboard shows it as "Data as of". To empty it, run `bi-load --empty`.

Elsewhere, run `load.sh` and `provision.sh` from this folder with `psql` 16.10
or later (or 17.6 or later), whose restricted mode the load needs. Each says at
its top what it needs. They read passwords only from files, never from
arguments or `PGPASSWORD`, and give each password to `psql` for the BI server
in `PGHOST` alone.

## Starter dashboards

- Applications by round and status
- Awards by programme and period
- Funding by organisation type

They are in `dashboards/`, in Superset's export format, and `contract.yaml`
names the warehouse model and data contract versions they target. Every
upgrade overwrites them. To change one, save a copy: copies, and a funder's
own charts, dashboards and saved queries, are never touched. Nothing in the
tool rejects, awards or pays, and nothing writes back to any database.

The import runs as the user `tps-bi-importer`, which owns the starter
dashboards. It is inactive and has no password, so nobody can sign in as it,
and each import resets it that way. Leave it in place.

Equality and monitoring data never reach the warehouse, so no dashboard can
show them. Fair-funding reports stay in Fairfold Grants.

## Looking after the data

- The warehouse is an export: treat it as internal data, the most sensitive
  class it holds. Load only the funder's own snapshot, and never load
  production data into a test or development environment. Anywhere but
  production, use synthetic data only.
- Do not back up the warehouse database. It is reloaded, and restoring an old
  copy would bring back erased people.
- Back up the metadata database with the application database
  ([ADR 0011](../../docs/adr/0011-backups-and-recovery.md)). It holds BI users'
  names and email addresses, kept until the funder leaves or the service is
  turned off, then for as long as its backups last.
- When someone leaves, remove them from the provider's BI groups. To end an
  open session at once, open **Settings**, then **List users**, edit the user
  and clear **Is active**. Otherwise it ends within 12 hours.
- When a funder leaves or turns the service off, remove its BI containers, its
  warehouse and metadata databases and their roles, its secret key and its
  OIDC client.

## Accessibility

Superset's viewer has gaps: chart content is drawn without a text
alternative, and the dashboard grid and filter bar are hard to use with a
keyboard. Every starter chart has a table beside it with the same numbers, and
charts label their values. Each gap goes in the
[known issues register](../../docs/accessibility/known-issues.md) once the
viewer has been checked.

## Tests

`infra/bi/test.sh` provisions two synthetic funders on a BI server in Docker,
loads their snapshots and checks the roles, the isolation, the network and the
dashboards' contract. Set `TPS_BI_IMAGE` to the image built from this folder's
`Dockerfile` to import the dashboards and start the tool as well.
