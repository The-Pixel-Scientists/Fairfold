# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Where the job may connect: the database, the Google APIs and the backup
# store, and nowhere else. The rules apply to the job's network tag alone.

locals {
  tag = "${local.name}-backup"

  # private.googleapis.com, which Private Google Access serves inside the VPC.
  egress = {
    database = { ranges = ["${data.google_sql_database_instance.db.private_ip_address}/32"], port = "5432" }
    google   = { ranges = ["199.36.153.8/30"], port = "443" }
    store    = { ranges = var.backup_store.ranges, port = "443" }
  }
}

# Without the network's private zone for the Google APIs, they resolve to
# public addresses the rules below drop, so the plan stops until it exists.
data "google_dns_managed_zone" "googleapis" {
  name = "${local.name}-googleapis"

  lifecycle {
    postcondition {
      condition     = self.dns_name == "googleapis.com." && self.visibility == "private"
      error_message = "The network root must create a private googleapis.com zone pointing at private.googleapis.com before this root is applied."
    }
  }
}

# Reaching the store's and Google's public ranges is the point of the rule;
# each range is named, and ADR 0011 says where the copies go.
#trivy:ignore:google-compute-no-public-egress
resource "google_compute_firewall" "allow_egress" {
  for_each = local.egress

  name               = "${local.tag}-allow-${each.key}"
  network            = data.google_compute_network.vpc.id
  direction          = "EGRESS"
  priority           = 1000
  target_tags        = [local.tag]
  destination_ranges = each.value.ranges

  allow {
    protocol = "tcp"
    ports    = [each.value.port]
  }

  log_config {
    metadata = "EXCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "deny_egress" {
  name               = "${local.tag}-deny-egress"
  network            = data.google_compute_network.vpc.id
  direction          = "EGRESS"
  priority           = 65000
  target_tags        = [local.tag]
  destination_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "EXCLUDE_ALL_METADATA"
  }
}
