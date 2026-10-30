# Load the warehouse snapshot into PostgreSQL

This page is for a data person. It shows how to take a funder's data out of
Fairfold Grants as one SQL file, load it into your own PostgreSQL, and join
awards to organisations and dates. You need `psql` and PostgreSQL 16 or later.

The snapshot is a copy of the data as it stands when you download it. It is
not a live feed, and it does not update. Download a new one when you want
fresh numbers.

## Get the snapshot

You need the **Administrator** role at the funder.

1. Sign in to the console and choose **Data** in the main navigation.
2. Under **Warehouse snapshot**, choose **Download warehouse snapshot**.
3. The browser saves one file named after the funder's address, such as
   `northfield-warehouse-snapshot.sql`. The page says "Saved" and the file's
   name.

Each download is recorded in the audit log as "platform.warehouse.exported",
with the number of rows in each table. If your data makes a file over 50 MB,
the page does not make it. It asks you to contact the operator for a copy.

The file is plain text. You can open it in an editor and read it before you
load it.

## What the snapshot holds

Eight tables, for the one funder whose administrator downloaded it:

| Table | One row for | Useful columns |
| --- | --- | --- |
| `organisation` | Every organisation | `id`, `name`, `legal_form`, `org_id` (such as `GB-CHC-1187654`), `org_id_verified`, `website`, `status` |
| `person` | Every person, applicants and staff alike, with no names or contact details | `id`, `status`, `created_at` |
| `programme` | Every grants programme, whatever its status | `id`, `title`, `summary`, `status`, `source_module` |
| `commitment` | Every released award | `programme_id`, `organisation_id`, `amount_minor`, `currency`, `committed_on`, `source_module` |
| `date` | Every day from the first commitment's day to the last | `date`, `year`, `quarter`, `month`, `fiscal_year`, `fiscal_quarter` |
| `grants_round` | Every round | `programme_id`, `title`, `opens_at`, `closes_at`, `budget_minor`, `award_min_minor`, `award_max_minor`, `currency` |
| `grants_application` | Every submitted or withdrawn application, without its answers | `round_id`, `organisation_id`, `applicant_person_id`, `status`, `submitted_at`, `submitted_late`, `withdrawn_at`, `outcome`, `commitment_id` |
| `grants_score` | Each criterion's score in a submitted review | `application_id`, `round_id`, `criterion`, `weight`, `score`, `submitted_at` |

Things to know when you query it:

- **Money is whole pence.** `amount_minor` and the `_minor` columns hold minor
  units (1,250,000 is £12,500.00), and `currency` holds the code, `GBP` today.
  Divide by 100 for pounds.
- **`commitment` holds released awards only.** An award that has been decided
  but not released is not in the file, in any table. In `grants_application`,
  `outcome` and `commitment_id` are empty until the decision is released.
- **`date` follows the funder's financial year.** The funder sets the month
  its year starts in **Settings**, **General**; it starts as April. So an award
  made in October is in `fiscal_year` 2026, `fiscal_quarter` 3.
- **`source_module`** says which part of the platform fed a row. Grants is
  `grants`. It lets later modules add rows to `programme` and `commitment`.
- **The top of the file says what it is.** The header holds the
  funder's id, the time of the download and `Model version`, which goes up
  whenever a table or column changes.

## What the snapshot leaves out

The snapshot holds no personal data. The code provides this: each table's
columns come from a fixed list, and a column is written only if the platform's
field classification marks every field it comes from as public or internal.
Personal and special category fields never go into the file. So the file
leaves out:

- names, email addresses, phone numbers and postal addresses of people, and
  of organisations' contacts;
- everything an applicant wrote: answers, budgets and uploaded files;
- reviewers' comments (their scores are in);
- drafts, which are the applicant's unfinished work;
- decisions that have not been released, and anything about them;
- the audit log, and the funder's settings.

Two things for the operator to judge. An organisation's name is in the file, so
a sole trader or small group named after a person puts that name in. And
`applicant_person_id` and `person.id` are ids that stand for people. They give
no name, but they link one person's applications together.

## Load it into PostgreSQL

Load it into a fresh database that you control, on your own machine or private
network. The file creates its tables in whichever schema comes first in your
search path (`public`, unless you changed it), so a database of its own is the
safest place.

With `psql` installed and a server you can reach:

```sh
createdb warehouse
psql -v ON_ERROR_STOP=1 -d warehouse -f northfield-warehouse-snapshot.sql
```

If you have Docker and no PostgreSQL, start a throwaway server and load the
file into it. Choose your own password, and keep the port on your machine only:

```sh
docker run --detach --name warehouse-db --env POSTGRES_PASSWORD=choose-a-password \
  --publish 127.0.0.1:55433:5432 postgres:16
docker exec warehouse-db psql -U postgres -c "CREATE DATABASE warehouse"
docker exec -i warehouse-db psql -U postgres -d warehouse -v ON_ERROR_STOP=1 -f - \
  < northfield-warehouse-snapshot.sql
```

You should see `BEGIN`, a `CREATE TABLE` for each of the eight tables, a `COPY`
with a row count for each, and `COMMIT`:

```
SET
BEGIN
CREATE TABLE   (eight times)
COPY 8
COPY 13
COPY 2
COPY 2
COPY 1
COPY 4
COPY 8
COPY 27
COMMIT
```

The counts are for the demo journey's data. Yours will differ, and match the
rows the audit event recorded.

### How the load works, and why it is safe

- The whole file runs in one transaction. `-v ON_ERROR_STOP=1` stops at the
  first error, and nothing is kept unless the file reaches `COMMIT`.
- The file sets `client_encoding` to UTF-8 itself, so your machine's language
  settings cannot change what a value loads as.
- Rows come in `COPY ... FROM stdin` blocks, not as `INSERT` statements. Every
  value is escaped for that format: a backslash, tab, new line or carriage
  return is written as an escape, so no value can end its block and run as SQL.
  The platform's tests load hostile values (a lone `\.`, `\N`, tabs, new lines,
  a quote followed by SQL) into a fresh PostgreSQL 16 with `psql` and get them
  back exactly.
- Table and column names come only from the platform's fixed model, never from
  data.

### If the load fails

| What you see | What it means |
| --- | --- |
| `ERROR:  relation "organisation" already exists` | You loaded into a database that already has the tables, perhaps from an earlier snapshot. Load into a new database. Nothing was changed, because the file runs in one transaction |
| `psql: error: ... No such file or directory` | `psql` could not find the file. Check the folder you are in, or give the whole path |
| A `COPY 0` for `commitment` and an empty `date` table | No decision has been released yet, so there are no commitments. Release a round's decisions in the console, then download again |
| The page says the snapshot is larger than 50 MB | Ask the operator for a copy |

## Join awards to organisations and dates

Each award is a row in `commitment`. It points to its programme and its
organisation, and its `committed_on` day is a row in `date`. This query lists
every award with all three:

```sql
SELECT o.name AS organisation,
       o.org_id,
       p.title AS programme,
       (c.amount_minor / 100.0)::numeric(14,2) AS amount,
       c.currency,
       c.committed_on,
       d.fiscal_year,
       d.fiscal_quarter
FROM commitment c
JOIN organisation o ON o.id = c.organisation_id
JOIN programme p ON p.id = c.programme_id
JOIN date d ON d.date = c.committed_on
ORDER BY c.committed_on, o.name;
```

Run it with `psql -d warehouse`, or with Docker:

```sh
docker exec -it warehouse-db psql -U postgres -d warehouse
```

On the demo journey's data, it gives the two awards:

```
     organisation      |     org_id     |       programme       |  amount  | currency | committed_on | fiscal_year | fiscal_quarter
-----------------------+----------------+-----------------------+----------+----------+--------------+-------------+----------------
 Mill Lane Music Group | GB-CHC-1203348 | Community Spaces Fund | 12500.00 | GBP      | 2026-10-23   |        2026 |              3
 Westgate Village Hall | GB-CHC-1203344 | Community Spaces Fund |  7500.00 | GBP      | 2026-10-23   |        2026 |              3
(2 rows)
```

Two more questions to start with. The total awarded in each quarter of the
financial year, by programme:

```sql
SELECT d.fiscal_year,
       d.fiscal_quarter,
       p.title AS programme,
       count(*) AS awards,
       (sum(c.amount_minor) / 100.0)::numeric(14,2) AS total
FROM commitment c
JOIN programme p ON p.id = c.programme_id
JOIN date d ON d.date = c.committed_on
GROUP BY d.fiscal_year, d.fiscal_quarter, p.title
ORDER BY d.fiscal_year, d.fiscal_quarter, p.title;
```

And, for each round, how much of its budget has been committed:

```sql
SELECT r.title AS round,
       (r.budget_minor / 100.0)::numeric(14,2) AS budget,
       count(a.id) AS applications,
       count(c.id) AS awards,
       (coalesce(sum(c.amount_minor), 0) / 100.0)::numeric(14,2) AS committed
FROM grants_round r
LEFT JOIN grants_application a ON a.round_id = r.id
LEFT JOIN commitment c ON c.id = a.commitment_id
GROUP BY r.id, r.title, r.budget_minor
ORDER BY r.title;
```

`date` is also the name of a PostgreSQL type, but it is a valid table name, and
the queries above work as written.

## Clean up

If you used the throwaway server, remove it, and the snapshot with it:

```sh
docker rm --force warehouse-db
```

Delete the `.sql` file too when you have finished with it. It is a copy of your
funder's data, and nothing in it expires.

## What the snapshot is not

It is not a backup: it holds the warehouse tables only, and nothing in it can
restore the platform. It is not a scheduled or incremental feed, and it does
not connect to BigQuery or any other service. Personal data in the warehouse
is not available yet, and will be off by default when it is.
