# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The nightly job on Cloud Run, with no ingress, all its traffic leaving
# through the cell's VPC under the firewall rules in egress.tf, and the
# schedule that starts it.

locals {
  env = merge(
    {
      TPS_DB_HOST               = local.db_host
      TPS_DB_PORT               = "5432"
      TPS_DB_TLS                = "verify-full"
      TPS_BACKUP_DATABASES      = var.databases
      TPS_BACKUP_PG_DUMP        = "/usr/local/bin/pg_dump"
      TPS_BACKUP_PSQL           = "/usr/local/bin/psql"
      TPS_BACKUP_AGE            = "/usr/local/bin/age"
      TPS_BACKUP_S3_CLIENT      = "/usr/local/bin/aws"
      TPS_BACKUP_STORE_ENDPOINT = var.backup_store.endpoint
      TPS_BACKUP_STORE_REGION   = var.backup_store.region
      TPS_BACKUP_STORE_BUCKET   = var.backup_store.bucket
      TPS_STORAGE_ENDPOINT      = "https://storage.googleapis.com"
      TPS_STORAGE_REGION        = "auto"
      TPS_STORAGE_BUCKET        = local.files_bucket
      TPS_BACKUP_KEY_ID         = var.key_id
      TPS_BACKUP_SCRATCH_DIR    = "/scratch"
    },
    { for name, env in local.secrets : env => "/run/secrets/${name}/value" },
  )
}

# A failed run is tried once more; a re-run on the same day finds the day's
# manifest and stops with already_complete.
resource "google_cloud_run_v2_job" "backup" {
  name     = local.tag
  location = local.region

  template {
    task_count = 1

    template {
      service_account = google_service_account.job.email
      max_retries     = 1
      timeout         = "14400s"

      vpc_access {
        network_interfaces {
          network    = data.google_compute_network.vpc.id
          subnetwork = data.google_compute_subnetwork.run.id
          tags       = [local.tag]
        }
        egress = "ALL_TRAFFIC"
      }

      containers {
        image = var.image
        args  = ["node", "infra/backup/src/main.ts"]

        resources {
          limits = { cpu = "2", memory = "4Gi" }
        }

        dynamic "env" {
          for_each = local.env
          content {
            name  = env.key
            value = env.value
          }
        }

        volume_mounts {
          name       = "scratch"
          mount_path = "/scratch"
        }

        dynamic "volume_mounts" {
          for_each = local.secrets
          content {
            name       = volume_mounts.key
            mount_path = "/run/secrets/${volume_mounts.key}"
          }
        }
      }

      # In memory, so it goes with the instance. Holds only encrypted output.
      volumes {
        name = "scratch"
        empty_dir {
          medium     = "MEMORY"
          size_limit = "2Gi"
        }
      }

      dynamic "volumes" {
        for_each = local.secrets
        content {
          name = volumes.key
          secret {
            secret = google_secret_manager_secret.secret[volumes.key].secret_id
            items {
              version = lookup(local.secret_versions, volumes.key, "latest")
              path    = "value"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.job]
}

resource "google_cloud_run_v2_job_iam_member" "trigger" {
  name     = google_cloud_run_v2_job.backup.name
  location = google_cloud_run_v2_job.backup.location
  role     = "roles/run.invoker"
  member   = google_service_account.trigger.member
}

# Dates are worked out in UTC (infra/backup/README.md), so the schedule is
# too: early enough that a failed 1st-of-month run can be repeated that day.
resource "google_cloud_scheduler_job" "backup" {
  name             = local.tag
  region           = local.region
  schedule         = "30 1 * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "60s"

  # Not retried: a lost reply could start a second run beside the first.
  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.backup.id}:run"

    oauth_token {
      service_account_email = google_service_account.trigger.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.api, google_cloud_run_v2_job_iam_member.trigger]
}
