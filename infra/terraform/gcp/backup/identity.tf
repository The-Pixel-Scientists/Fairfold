# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The backup job's identities and secrets. The job runs as its own service
# account, used by nothing else, with no project-level role: it reads only
# its own secrets, and in the backup project only what archive.tf grants.
# The backup role's password is a secret no other identity can read
# (ADR 0011). The live files are read through an HMAC key on an account of
# its own, limited to clean/, as the services root does for each key purpose.

resource "google_service_account" "job" {
  account_id   = "${local.name}-backup"
  display_name = "backup job"
  description  = "Runs the off-site backup job on Cloud Run, and nothing else."
}

resource "google_service_account" "trigger" {
  account_id   = "${local.name}-backup-run"
  display_name = "backup trigger"
  description  = "Starts the backup job on schedule. It reads no data."
}

resource "google_service_account" "source" {
  account_id   = "${local.name}-st-backup"
  display_name = "backup storage key"
  description  = "Holds the backup job's read key for clean/ in the files bucket. No workload runs as it."
}

resource "google_storage_bucket_iam_member" "source" {
  bucket = local.files_bucket
  role   = "roles/storage.objectViewer"
  member = google_service_account.source.member

  condition {
    title      = "clean/ only"
    expression = "resource.name.startsWith(\"projects/_/buckets/${local.files_bucket}/objects/clean/\")"
  }
}

resource "google_storage_hmac_key" "source" {
  service_account_email = google_service_account.source.email
}

locals {
  # Values the operator adds are mounted at their latest version; those set
  # from code at the version code wrote, so a new value rolls out with it.
  secrets = {
    backup-db-password        = "TPS_DB_BACKUP_READER_PASSWORD_FILE"
    backup-db-ca              = "TPS_DB_TLS_CA_FILE"
    backup-store-credentials  = "TPS_BACKUP_STORE_CREDENTIALS_FILE"
    backup-source-credentials = "TPS_BACKUP_SOURCE_CREDENTIALS_FILE"
    backup-recipients         = "TPS_BACKUP_RECIPIENTS_FILE"
  }
  secret_versions = {
    backup-db-ca              = google_secret_manager_secret_version.db_ca.version
    backup-source-credentials = google_secret_manager_secret_version.source.version
  }
}

resource "google_secret_manager_secret" "secret" {
  for_each = local.secrets

  secret_id = "${local.name}-${each.key}"

  replication {
    user_managed {
      replicas {
        location = local.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "job" {
  for_each = local.secrets

  secret_id = google_secret_manager_secret.secret[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.job.member
}

# Public certificates, mounted so the setting reads a file like the others.
resource "google_secret_manager_secret_version" "db_ca" {
  secret      = google_secret_manager_secret.secret["backup-db-ca"].id
  secret_data = join("", data.google_sql_ca_certs.db.certs[*].cert)
}

# The S3 client's shared-credentials file for the read key.
resource "google_secret_manager_secret_version" "source" {
  secret      = google_secret_manager_secret.secret["backup-source-credentials"].id
  secret_data = <<-EOT
    [default]
    aws_access_key_id = ${google_storage_hmac_key.source.access_id}
    aws_secret_access_key = ${google_storage_hmac_key.source.secret}
  EOT
}
