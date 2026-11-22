# Loading the snapshot

The snapshot is your warehouse as one file. You download it from the console,
load it into a database of its own, and ask questions of it with SQL or the
[starter dashboards](starter-dashboards.md). This guide covers who can do
that and what to look after. The steps for loading are in the
[self-hosting guide](../../../docs/self-hosting/warehouse-snapshot.md), which
this page does not repeat.

## Download the snapshot

You need the **Download the warehouse snapshot** permission. Administrators
have it.

1. Sign in to the console and choose **Data** in the main navigation.
2. Under **Warehouse snapshot**, choose **Download warehouse snapshot**.
3. The browser saves one file, named after your funder's address, such as
   `northfield-warehouse-snapshot.sql`.

The file is a PostgreSQL load script: plain text with `CREATE TABLE`
statements and the data. You can open it in an editor and read it.

Each download is recorded in the [audit log](../../../docs/admin/audit-log.md)
as "platform.warehouse.exported", with the number of rows in each table.
The event holds counts, not the data.

A file over 50 MB is not made. The page asks you to contact the operator for
a copy.

The tables and columns are in [Data contracts](data-contracts.md). The header
at the top of the file holds your funder's id, the time of the download and
the warehouse model version.

## Load it

Use a separate warehouse database for each funder. Never load one funder's
snapshot into another's database, and never into the application's own
database.

- **With `psql`.** Follow
  [Load the warehouse snapshot into PostgreSQL](../../../docs/self-hosting/warehouse-snapshot.md).
  It uses `psql -v ON_ERROR_STOP=1`, so the whole file loads or none of it
  does.
- **With the BI service.** The operator loads the file with the scripts in
  `infra/bi/`, which check the snapshot belongs to your funder and refuse one
  more than 30 days old. See the
  [BI service guide for operators](../../../infra/bi/README.md). On the
  managed service, pass the file to the operator over the support channel's
  secure transfer, and do not open and save it first. The load refuses a file
  that has been changed.

## Reload to refresh it

A snapshot is a copy at one moment. It does not update.

- Download a new snapshot whenever you need fresh figures.
- With the BI service, a load replaces every row in one transaction. People
  erased in the application since the last snapshot are gone from the
  warehouse at the next load, and so are changes to awards and organisations.
- With `psql`, the file refuses a database that already has the tables. Load
  the new file into a new database, check it, then drop the old one.

This release has one way to get data in: a download you make and load. There
is no scheduled or incremental delivery, and no link to BigQuery or any other
service.

## Look after the copy

The snapshot holds no personal data. It is still a copy of your funder's data.

- **Treat it as internal data,** the most sensitive class it holds. Keep it
  where, and under the rules by which, you keep other organisational data.
  Share it only with people who need it.
- **Do not back it up.** It can be made again. Restoring an old copy would
  bring back people erased since.
- **Remove it when you stop needing it.** Delete the file and drop the
  warehouse database. Nothing in the file expires.
- **Never load real data into a test or development environment.** Use
  synthetic data anywhere but production.
- **Record each load,** with the date and who did it, in your own log.

The software provides the audit record of the download and the filter that
keeps personal data out. You provide the places the copy is kept, who can
open them, and the deletion.
