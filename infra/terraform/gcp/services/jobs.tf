# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The worker, the migrate job and the tenant-create job, from the API's image
# by digest, each as its own service account, with all their traffic leaving
# through the cell's VPC and no ingress. The worker is a worker pool, not a
# service: it opens no port (ADR 0009), and a service must answer on one to
# start. The jobs run only when an operator, or for migrate the release
# pipeline, executes them.

# One instance, always running with its CPU, and no ingress of any kind.
resource "google_cloud_run_v2_worker_pool" "worker" {
  name     = "${local.name}-worker"
  location = local.region

  scaling {
    manual_instance_count = 1
  }

  template {
    service_account = google_service_account.workload["worker"].email

    vpc_access {
      network_interfaces {
        network    = data.google_compute_network.vpc.id
        subnetwork = data.google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }

    containers {
      image = var.images.api
      args  = ["node", "apps/api/src/worker.ts"]

      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }

      dynamic "env" {
        for_each = local.env["worker"]
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "volume_mounts" {
        for_each = local.mounts["worker"]
        content {
          name       = volume_mounts.key
          mount_path = "/run/secrets/${volume_mounts.key}"
        }
      }
    }

    dynamic "volumes" {
      for_each = local.mounts["worker"]
      content {
        name = volumes.key
        secret {
          secret = google_secret_manager_secret.secret[volumes.key].secret_id
          items {
            version = volumes.value.version
            path    = "value"
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.reader]
}

# Applies pending migrations as migrator (ADR 0003), never as the operators'
# admin or the backup role. Not retried: a failed migration needs a person.
resource "google_cloud_run_v2_job" "migrate" {
  name     = "${local.name}-migrate"
  location = local.region

  template {
    task_count = 1

    template {
      service_account = google_service_account.workload["migrate"].email
      max_retries     = 0
      timeout         = "1800s"

      vpc_access {
        network_interfaces {
          network    = data.google_compute_network.vpc.id
          subnetwork = data.google_compute_subnetwork.run.id
        }
        egress = "ALL_TRAFFIC"
      }

      containers {
        image = var.images.api
        args  = ["node", "packages/db/scripts/db.ts", "up"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        dynamic "env" {
          for_each = local.env["migrate"]
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "volume_mounts" {
          for_each = local.mounts["migrate"]
          content {
            name       = volume_mounts.key
            mount_path = "/run/secrets/${volume_mounts.key}"
          }
        }
      }

      dynamic "volumes" {
        for_each = local.mounts["migrate"]
        content {
          name = volumes.key
          secret {
            secret = google_secret_manager_secret.secret[volumes.key].secret_id
            items {
              version = volumes.value.version
              path    = "value"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.reader]
}

# The operator's `pnpm tenant:create` (ADR 0019), as app_worker, run inside the
# cell with the arguments given at execution. Not retried: a second run could
# send a second invitation. The release pipeline can neither run it nor
# change it; it takes a new image when this root is applied.
resource "google_cloud_run_v2_job" "tenant_create" {
  name     = "${local.name}-tenant-create"
  location = local.region

  template {
    task_count = 1

    template {
      service_account = google_service_account.workload["operator"].email
      max_retries     = 0
      timeout         = "300s"

      vpc_access {
        network_interfaces {
          network    = data.google_compute_network.vpc.id
          subnetwork = data.google_compute_subnetwork.run.id
        }
        egress = "ALL_TRAFFIC"
      }

      containers {
        image   = var.images.api
        command = ["node", "apps/api/src/operator/create-tenant.ts"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        dynamic "env" {
          for_each = local.env["operator"]
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "volume_mounts" {
          for_each = local.mounts["operator"]
          content {
            name       = volume_mounts.key
            mount_path = "/run/secrets/${volume_mounts.key}"
          }
        }
      }

      dynamic "volumes" {
        for_each = local.mounts["operator"]
        content {
          name = volumes.key
          secret {
            secret = google_secret_manager_secret.secret[volumes.key].secret_id
            items {
              version = volumes.value.version
              path    = "value"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.reader]
}
