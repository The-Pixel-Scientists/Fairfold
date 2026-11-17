# SPDX-License-Identifier: AGPL-3.0-or-later
#
# api, console and portal, from the release images by digest, each as its own
# service account, with all their traffic leaving through the cell's VPC.
# They take traffic only from the load balancer (ADR 0030) and have no
# run.app address. No one is granted run.invoker yet: the load balancer, and
# the public invoker binding it needs, come with the first rollout, so
# applying this root makes nothing reachable.

resource "google_cloud_run_v2_service" "service" {
  for_each = local.services

  name                 = "${local.name}-${each.key}"
  location             = local.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  default_uri_disabled = true

  template {
    service_account = google_service_account.workload[each.key].email

    scaling {
      max_instance_count = 4
    }

    vpc_access {
      network_interfaces {
        network    = data.google_compute_network.vpc.id
        subnetwork = data.google_compute_subnetwork.run.id
      }
      egress = "ALL_TRAFFIC"
    }

    containers {
      image = each.value.image
      args  = each.value.args

      ports {
        container_port = each.value.port
      }

      resources {
        limits = { cpu = "1", memory = each.value.memory }
      }

      dynamic "env" {
        for_each = local.env[each.key]
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "volume_mounts" {
        for_each = local.mounts[each.key]
        content {
          name       = volume_mounts.key
          mount_path = "/run/secrets/${volume_mounts.key}"
        }
      }
    }

    dynamic "volumes" {
      for_each = local.mounts[each.key]
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
