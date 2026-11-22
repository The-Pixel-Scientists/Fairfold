# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One address, HTTPS on 443 and a redirect on 80. The URL map answers the
# console and portal hosts only: under each, /api/ goes to the API and the
# rest to that host's web app. Any other host gets 404 and reaches no
# backend, and nothing routes to Cloud Storage (ADR 0030).

locals {
  workloads = toset(["api", "console", "portal"])
  hsts      = "Strict-Transport-Security: max-age=63072000; includeSubDomains"
}

resource "google_compute_global_address" "edge" {
  name       = "${local.name}-edge"
  ip_version = "IPV4"
}

# Named for its hosts, so a change of host makes a new certificate before the
# old one goes.
resource "google_compute_managed_ssl_certificate" "edge" {
  name = "${local.name}-edge-${substr(sha256(join(",", values(local.hosts))), 0, 8)}"

  managed {
    domains = values(local.hosts)
  }

  lifecycle {
    create_before_destroy = true
  }
}

# TLS 1.2 and 1.3 only, as Mozilla's "intermediate" settings.
resource "google_compute_ssl_policy" "edge" {
  name            = "${local.name}-edge"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_region_network_endpoint_group" "workload" {
  for_each = local.workloads

  name                  = "${local.name}-${each.key}"
  region                = local.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = "${local.name}-${each.key}"
  }
}

# The services take traffic only from a load balancer, so letting anyone
# invoke them admits only what comes through this one.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = local.workloads

  name     = "${local.name}-${each.key}"
  location = local.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The request log records the full URL, query string included, so it is off.
# A serverless backend takes Cloud Run's request timeout, which the services
# root sets to 150 seconds for the API.
resource "google_compute_backend_service" "workload" {
  for_each = local.workloads

  name                    = "${local.name}-${each.key}"
  load_balancing_scheme   = "EXTERNAL_MANAGED"
  protocol                = "HTTPS"
  custom_response_headers = [local.hsts]
  security_policy         = each.key == "api" ? google_compute_security_policy.api.id : null

  backend {
    group = google_compute_region_network_endpoint_group.workload[each.key].id
  }

  log_config {
    enable = false
  }
}

resource "google_compute_url_map" "https" {
  name = "${local.name}-edge"

  # A host nobody named: 404 from the load balancer, before any backend.
  default_service = google_compute_backend_service.workload["portal"].id
  default_route_action {
    fault_injection_policy {
      abort {
        http_status = 404
        percentage  = 100
      }
    }
  }

  dynamic "host_rule" {
    for_each = local.hosts
    content {
      hosts        = [host_rule.value]
      path_matcher = host_rule.key
    }
  }

  # The load balancer passes a client's forwarding headers through, so each
  # host drops them and sets X-Forwarded-Host to the host it matched, every
  # value the client sent replaced.
  dynamic "path_matcher" {
    for_each = local.hosts
    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.workload[path_matcher.key].id

      header_action {
        request_headers_to_remove = ["Forwarded", "X-Real-IP"]
        request_headers_to_add {
          header_name  = "X-Forwarded-Host"
          header_value = path_matcher.value
          replace      = true
        }
      }

      path_rule {
        paths   = ["/api/*"]
        service = google_compute_backend_service.workload["api"].id
      }
    }
  }

  lifecycle {
    precondition {
      condition     = local.hosts.console != local.hosts.portal
      error_message = "The console and portal need a host each: the load balancer tells them apart by host."
    }
  }
}

resource "google_compute_target_https_proxy" "edge" {
  name             = "${local.name}-edge"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.edge.id]
  ssl_policy       = google_compute_ssl_policy.edge.id
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${local.name}-edge-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_protocol           = "TCP"
  ip_address            = google_compute_global_address.edge.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.edge.id
}

# Port 80 only redirects to HTTPS, keeping the path and query.
resource "google_compute_url_map" "http" {
  name = "${local.name}-edge-http"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "edge" {
  name    = "${local.name}-edge-http"
  url_map = google_compute_url_map.http.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${local.name}-edge-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_protocol           = "TCP"
  ip_address            = google_compute_global_address.edge.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.edge.id
}
