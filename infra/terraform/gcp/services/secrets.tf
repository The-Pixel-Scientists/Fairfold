# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Every secret a workload reads, each mounted as its own file and named by
# the setting's existing NAME_FILE variable (ADR 0010). Each is readable by
# the workloads that use it and by no one else; nothing is granted at
# project level. Secrets stay in the cell's region.
#
# The operator adds the value of every secret below except the database CA
# and the storage keys, which come from code (see the README). The HMAC
# secrets therefore sit in this root's state, which only operators can read.

locals {
  secrets = {
    db-app-api-password    = { env = "TPS_DB_APP_API_PASSWORD_FILE", readers = ["api"] }
    db-app-auth-password   = { env = "TPS_DB_APP_AUTH_PASSWORD_FILE", readers = ["api"] }
    db-app-worker-password = { env = "TPS_DB_APP_WORKER_PASSWORD_FILE", readers = ["worker"] }
    db-app-queue-password  = { env = "TPS_DB_APP_QUEUE_PASSWORD_FILE", readers = ["worker"] }
    db-migrator-password   = { env = "TPS_DB_MIGRATOR_PASSWORD_FILE", readers = ["migrate"] }
    db-ca                  = { env = "TPS_DB_TLS_CA_FILE", readers = ["api", "worker", "migrate"] }
    auth-secret            = { env = "TPS_AUTH_SECRET_FILE", readers = ["api"] }
    request-limit-key      = { env = "TPS_REQUEST_LIMIT_KEY_FILE", readers = ["api"] }
    subject-kek            = { env = "TPS_SUBJECT_KEK_FILE", readers = ["api", "worker"] }
    smtp-password          = { env = "TPS_SMTP_PASSWORD_FILE", readers = ["api", "worker"] }
    storage-write          = { env = "TPS_STORAGE_WRITE_SECRET_ACCESS_KEY_FILE", readers = ["api", "worker"] }
    storage-read           = { env = "TPS_STORAGE_READ_SECRET_ACCESS_KEY_FILE", readers = ["api", "worker"] }
    storage-scanner        = { env = "TPS_STORAGE_SCANNER_SECRET_ACCESS_KEY_FILE", readers = ["api", "worker"] }
    storage-removal        = { env = "TPS_STORAGE_REMOVAL_SECRET_ACCESS_KEY_FILE", readers = ["worker"] }
  }

  # Secrets set from code are mounted at the version code wrote, so a new
  # value rolls out a new revision; the rest at their latest version.
  secret_versions = merge(
    { for purpose, version in google_secret_manager_secret_version.storage : "storage-${purpose}" => version.version },
    { db-ca = google_secret_manager_secret_version.db_ca.version },
  )

  secret_readers = merge([
    for name, secret in local.secrets : {
      for workload in secret.readers : "${name}/${workload}" => { secret = name, workload = workload }
    }
  ]...)
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

  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_iam_member" "reader" {
  for_each = local.secret_readers

  secret_id = google_secret_manager_secret.secret[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.workload[each.value.workload].member
}

# Public certificates, mounted so the setting reads a file like the others.
resource "google_secret_manager_secret_version" "db_ca" {
  secret      = google_secret_manager_secret.secret["db-ca"].id
  secret_data = join("", data.google_sql_ca_certs.db.certs[*].cert)
}

resource "google_secret_manager_secret_version" "storage" {
  for_each = google_storage_hmac_key.files

  secret      = google_secret_manager_secret.secret["storage-${each.key}"].id
  secret_data = each.value.secret
}
