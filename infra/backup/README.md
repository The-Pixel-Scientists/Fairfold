# Off-site backup job

Each night this job writes a complete, encrypted snapshot of the service to
an S3-compatible store with object lock. It runs against any PostgreSQL 16 or
later and any such store. The decisions behind it are in
[ADR 0011](../../docs/adr/0011-backups-and-recovery.md).

A snapshot holds:

- a full dump of each database, in `pg_dump`'s custom format, leaving out
  `app.subject_key`;
- a key snapshot: the `app.subject_key` rows, still wrapped, from the same
  database snapshot as the dump, kept for 35 days whatever the snapshot's tier;
- each clean file added since the last complete snapshot, never the quarantine
  prefix;
- a manifest listing everything the snapshot needs to restore in full, and a
  reference index beside it.

## How it runs

```
node infra/backup/src/main.ts
```

The job calls `pg_dump`, `psql`, `age` and an S3 command-line client (AWS CLI
version 2, or anything with the same arguments), and adds no npm dependency.
`pg_dump` must be at least as new as the server. The job is one process, run on
a schedule; it prints one line, the run record, and exits non-zero unless the
snapshot is complete.

The run, in order:

1. Refuse to start unless the recipients file holds only public keys, the
   connection is the backup role (`backup_reader`) with its row-security
   exemption, and the versions are right. It never uses
   `--enable-row-security`, which returns only the rows a role can see.
2. Stop, writing nothing, unless the bucket reports versioning and object lock
   on. Write a probe object and stop unless its compliance-mode lock reads
   back.
3. Stop with `already_complete` if a manifest exists for today in UTC.
4. Dump and encrypt, with plain data never touching the disk. Each file comes
   from the live store through `age`, checked against the hash the database
   holds.
5. Upload everything under the daily lock, read each object back and check its
   hash, then lengthen the locks to the snapshot's tier.
6. Write the reference index, then the manifest last. A snapshot with no
   manifest is incomplete and is never used.
7. Prune, then write the run record.

### Settings

| Variable                                                                          | What it is                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `TPS_DB_HOST`, `TPS_DB_PORT`                                                      | The database server                                                            |
| `TPS_DB_TLS`, `TPS_DB_TLS_CA_FILE`                                                | `verify-full` and its CA file. Only a server on this machine may use `disable` |
| `TPS_DB_BACKUP_READER_PASSWORD_FILE`                                              | File holding the backup role's password                                        |
| `TPS_BACKUP_DATABASES`                                                            | Databases to dump, comma-separated; the first holds the application schema     |
| `TPS_BACKUP_PG_DUMP`, `TPS_BACKUP_PSQL`, `TPS_BACKUP_AGE`, `TPS_BACKUP_S3_CLIENT` | Absolute paths to the tools                                                    |
| `TPS_BACKUP_STORE_ENDPOINT`, `_REGION`, `_BUCKET`                                 | The backup store                                                               |
| `TPS_BACKUP_STORE_CREDENTIALS_FILE`                                               | Shared-credentials file for the backup store                                   |
| `TPS_STORAGE_ENDPOINT`, `_REGION`, `_BUCKET`                                      | The live file store                                                            |
| `TPS_BACKUP_SOURCE_CREDENTIALS_FILE`                                              | Shared-credentials file with read access to the clean prefix only              |
| `TPS_BACKUP_RECIPIENTS_FILE`                                                      | `age` public recipients, one per line                                          |
| `TPS_BACKUP_KEY_ID`                                                               | Id of the key version those recipients belong to                               |
| `TPS_BACKUP_SCRATCH_DIR`                                                          | Parent of the job's temporary directory, wiped on exit                         |

Credentials come only from files named by `_FILE` variables. A credential set
as a value in the environment is refused, none is passed in an argument or
through the commands' environment, and the commands get a fresh environment
that holds nothing inherited. The password file is copied for the run into a
`pgpass` file, readable only by the job, in the scratch directory.

The run log has the run id, outcome code, tier and counts. Errors are codes,
and a command's own error output is dropped, since it can name hosts and files.

## Retain-until rule

Every date is worked out from the snapshot's start in UTC, so clock changes
and time zones cannot move it.

| Tier    | Which snapshot       | Locked for         |
| ------- | -------------------- | ------------------ |
| Daily   | Every snapshot       | 35 days            |
| Monthly | The 1st of the month | 12 calendar months |
| Yearly  | 1 January            | 7 calendar years   |

- Every object is locked in compliance mode, for its own date.
- A file's lock is lengthened to the longest tier of any snapshot that
  references it, and is never shortened.
- A missed night is not made up by moving a tier: a snapshot on the 2nd is a
  daily snapshot. Run the job again on the 1st if it failed, before the day
  ends in UTC.
- Run records are locked for 12 months. The job can create one but not delete
  one, so prune leaves them alone: a lifecycle rule on the `runs/` prefix, or a
  separate identity, removes them once their lock has expired.
- Nothing is locked for longer than its tier and one day; the job refuses a
  later date.

**A wrong 7-year date costs 7 years of storage.** A compliance-mode lock cannot
be shortened or removed by anyone, including the provider and whoever holds the
account. Test any change to these rules against a store you can throw away.

Objects go up under the daily lock and only reach their tier's lock once the
whole snapshot has been read back, so a 1 January run that fails leaves
leftovers that expire in 35 days and not in 7 years.

## What it stores

Object names hold ids and hashes only. The manifest is encrypted. It holds the
format version, ids, hashes, sizes, the key id, the migration and roles script
versions, the PostgreSQL and `pg_dump` versions, the tier and its retain-until
date, and no file names or personal data. Later format versions can add fields,
such as the erasure ledger.

The job cannot decrypt its own manifests, by design. The next run and the prune
step read the **reference index** instead: a plain file beside each manifest
listing the object names, ciphertext hashes and sizes, and lock dates of what
that snapshot uses. It shows nothing a listing of the bucket does not already,
and holds no hash of a file's content. The run record is plain for the same
reason, and so that alerting can read an outcome.

Prune removes an object only when its lock has expired and no manifest still
within its own retention references it. It fails towards keeping data: a lock
it cannot read keeps the object, and a live snapshot's index it cannot read
stops the prune and reports `prune_failed`. Key snapshots are deliberately not
in the index, so they go after 35 days even under a live yearly manifest. Run
records are never prune candidates, and prune does not read their locks.

## Keys and escrow

The job encrypts to public `age` recipients and holds no private key, so it
cannot read what it wrote. The recipients file is refused if it holds anything
other than public recipients.

- Generate key pairs offline, never on a production host or with the hosting
  provider.
- Hold the private halves in escrow, outside the hosting provider and apart
  from the backup store, in at least two places.
- Keep every key version for at least 7 years after the last copy it protects
  expires, and never destroy one earlier.
- Rotate by adding a new recipient and a new `TPS_BACKUP_KEY_ID`. Old snapshots
  are not re-encrypted: each object records the key version that encrypted it,
  in its manifest entry and its metadata.

Where the escrow is held, and who may recover from it, is decided before live
data is held.

## Tests

```
node --test "infra/backup/src/*.test.ts"
bash infra/backup/test/restore.sh
```

The unit tests fake the commands and the store. `restore.sh` runs the job
against a real PostgreSQL and S3 target, decrypts with a throwaway key,
restores, and compares row counts and file hashes; it needs the tools above and
`pg_restore`, and is not part of `pnpm check`.
