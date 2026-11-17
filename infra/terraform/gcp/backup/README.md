# Backup root

The off-site backup on Google Cloud
([ADR 0011](../../../../docs/adr/0011-backups-and-recovery.md)): the nightly
job from [`infra/backup/`](../../../backup/README.md) in the cell's project,
and the Google archive in a separate backup project.

| Resource                         | What it is                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `google_project.backup`          | The backup project, in the same organisation, with a lien against deletion                 |
| `google_storage_bucket.archive`  | Archive class in `europe-west2`, private, object retention on, data access audit logs on   |
| `archive_writer` role            | What the job may do in the archive, and nothing else                                       |
| `google_cloud_run_v2_job.backup` | The job, as its own service account, with no ingress and Direct VPC egress                 |
| `google_compute_firewall.*`      | Egress for the job's tag: the database, `private.googleapis.com` and the backup store only |
| `google_cloud_scheduler_job`     | Starts the job at 01:30 UTC each night, as a service account that can do only that         |
| Secrets                          | The job's five settings files, readable by the job's service account alone                 |
| `backup_missed` alert            | Fires when no complete snapshot is logged for 26 hours                                     |

Every resource is named `tps-<environment>-<cell>-…` and labelled with
`environment` and `cell`, in both projects.

## The job

The job runs the backup image's `node infra/backup/src/main.ts` with the
settings in its README. It connects to Cloud SQL at its private address as
`backup_reader`, over TLS with `verify-full`, and reads the live files under
`clean/` with an HMAC key whose account may read nothing else. Its scratch
directory is a 2 GiB in-memory volume, gone when the instance ends; a larger
dump needs a larger volume and memory limit, up to Cloud Run's 32 GiB.

The image must put `pg_dump`, `psql`, `age` and the S3 client (`aws`) in
`/usr/local/bin`, run as a non-root user, and have the repository at its
working directory. Cloud Run has no read-only root file system; the job
writes only to the scratch volume.

No other identity can read the backup role's password: the secret is
granted to the job's service account alone, and no role in the project is
granted on it.

The scheduler is not retried, because a lost reply could start a second run
beside the first. The job retries once itself, one run after the other; a
re-run on a day that already has a manifest stops with `already_complete`.

## The archive

Production's job identity is granted the `archive_writer` role on the
bucket, and nothing else in the backup project:

| Permission                     | Why                                                     |
| ------------------------------ | ------------------------------------------------------- |
| `storage.objects.create`       | Add a snapshot's objects                                |
| `storage.objects.setRetention` | Set a new object's retention and lengthen an old one's  |
| `storage.objects.update`       | Needed with `setRetention` to change an existing object |
| `storage.objects.list`         | See names, sizes, checksums and retention dates         |
| `storage.buckets.get`          | Read the bucket's settings                              |

It has no `storage.objects.get`, so it cannot read content, no
`storage.objects.delete`, so it can neither delete nor overwrite, and no
retention override or IAM permission. Locked retention can be lengthened but
never shortened, by anyone. Objects leave only through the lifecycle rule,
which deletes an object 367 days after it was written and is held back by
its retention date. `storage.objects.update` also lets the identity change an
object's metadata, though not its content or its lock.

The bucket has no bucket-level retention policy: each object carries its own
date, set by the job. The data access audit logs go to the backup project's
`_Default` log bucket, which keeps them for 30 days.

Check these against Google's documentation before the first apply, and
correct this section if any has changed: that setting or lengthening an
object's retention needs `storage.objects.setRetention` with
`storage.objects.update`; that a role without `storage.objects.delete` cannot
overwrite an object; and that the lifecycle rule waits for an object's
retention date.

**The job does not write to the archive yet.** Its archive step, which
copies the monthly and yearly snapshots and the files the archive lacks,
comes with a later change, and until then the bucket stays empty. The
identity in the backup project that checks every object's date each day is
also still to come.

## Before you apply

- The network, database, services and monitoring roots are applied.
- The roles script has created `backup_reader` and set its password.
- The backup store exists, as `infra/backup/README.md` sets out, and you know
  the address ranges its endpoint resolves to.
- The backup image is in a registry the project can pull from.
- The network has a private DNS zone that sends Google API traffic to
  `private.googleapis.com` (`199.36.153.8/30`). **No root creates this zone
  yet.** The firewall here admits no other Google address, so without it
  `storage.googleapis.com` resolves to public addresses, the job cannot read
  the files bucket, and every night with a new file ends in `source_failed`.
  Do not apply this root until the network root adds the zone, named
  `tps-<environment>-<cell>-googleapis`, with `A` records for
  `private.googleapis.com` and a `*.googleapis.com` `CNAME` to it, attached
  to the VPC. The plan stops until a private zone of that name exists.
- You may create projects in the organisation and link the billing account.

Inputs come from the environment, as for the other roots:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
export TF_VAR_backup_project='{ id = "<new project id>", org_id = "<organisation id>", billing_account = "<billing account>" }'
export TF_VAR_image=<registry>/backup@sha256:<digest>
export TF_VAR_backup_store='{ endpoint = "https://<host>", region = "<region>", bucket = "<bucket>", ranges = ["<range>"] }'
export TF_VAR_key_id=<key version id>
tofu -chdir=infra/terraform/gcp/backup init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/backup"
```

## Apply

The job cannot start until its secrets have values, so create the secrets
first, add the values, then apply the rest:

```sh
tofu -chdir=infra/terraform/gcp/backup apply -target=google_secret_manager_secret.secret
gcloud secrets versions add tps-staging-uk-backup-db-password --data-file=<file>
tofu -chdir=infra/terraform/gcp/backup apply
```

| Secret                      | Setting                              | Value                                                 |
| --------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `backup-db-password`        | `TPS_DB_BACKUP_READER_PASSWORD_FILE` | The password the roles script set for `backup_reader` |
| `backup-store-credentials`  | `TPS_BACKUP_STORE_CREDENTIALS_FILE`  | The backup store's key, as a shared-credentials file  |
| `backup-recipients`         | `TPS_BACKUP_RECIPIENTS_FILE`         | The `age` public recipients for `TF_VAR_key_id`       |
| `backup-db-ca`              | `TPS_DB_TLS_CA_FILE`                 | Set from code: the instance's CA certificates         |
| `backup-source-credentials` | `TPS_BACKUP_SOURCE_CREDENTIALS_FILE` | Set from code: the read key for `clean/`              |

A shared-credentials file has a `[default]` section with
`aws_access_key_id` and `aws_secret_access_key`. The read key's secret is in
this root's state, as the services root's keys are. To rotate it:

```sh
tofu -chdir=infra/terraform/gcp/backup apply -replace=google_storage_hmac_key.source
```

To rotate the backup key, add the new recipients as a new version of
`backup-recipients` and apply with the new `TF_VAR_key_id`.

## The alert

The job prints its run record as JSON, which Cloud Run logs. A log-based
metric counts the records whose outcome is `ok` or `already_complete`, and
the policy alerts the monitoring root's operators channel when none has
arrived for 26 hours, whether the run failed or never started. A fresh
apply alerts until the first complete run. The runbook is
[Check the last backup](../../../../docs/runbooks/restore.md#check-the-last-backup).

## Checks

```sh
tofu -chdir=infra/terraform fmt -check -recursive
tofu -chdir=infra/terraform/gcp/backup init -backend=false -lockfile=readonly
tofu -chdir=infra/terraform/gcp/backup validate
tofu -chdir=infra/terraform/gcp/backup test
trivy config --severity HIGH,CRITICAL --exit-code 1 infra/terraform/gcp/backup
```

The egress rules carry one inline Trivy ignore: they name public ranges,
the backup store's and `private.googleapis.com`, which is what they are for.

## Rolling back

Pause the schedule first, which stops new snapshots and writes nothing:

```sh
gcloud scheduler jobs pause tps-staging-uk-backup --location=europe-west2
```

Then re-apply the previous commit. Locked objects cannot be removed before
their date, by anyone, and the bucket cannot be deleted while it holds them.
The bucket has `prevent_destroy`, and the project has a lien and
`deletion_policy = "PREVENT"`: removing any of them takes a reviewed change
that turns its protection off first.
