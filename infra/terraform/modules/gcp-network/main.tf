# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The cell's private network: one subnet for Cloud Run's direct VPC egress,
# private services access for Cloud SQL, no inbound path, and one known
# address for outbound calls.

resource "google_project_service" "api" {
  for_each = toset([
    "compute.googleapis.com",
    "dns.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "vpc" {
  name                    = var.name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.api]
}

resource "google_compute_subnetwork" "run" {
  name                     = "${var.name}-run"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.subnet_range
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_global_address" "services" {
  name          = "${var.name}-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.services.name]
}

# Nothing is admitted from anywhere. The rule makes the implied deny explicit
# and logs what it drops.
resource "google_compute_firewall" "deny_ingress" {
  name          = "${var.name}-deny-all-ingress"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  priority      = 65535
  source_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "EXCLUDE_ALL_METADATA"
  }
}

resource "google_compute_router" "egress" {
  name    = "${var.name}-egress"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_address" "egress" {
  name         = "${var.name}-egress"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  depends_on = [google_project_service.api]
}

resource "google_compute_router_nat" "egress" {
  name                               = "${var.name}-egress"
  region                             = var.region
  router                             = google_compute_router.egress.name
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.run.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
