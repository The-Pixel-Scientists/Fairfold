# SPDX-License-Identifier: AGPL-3.0-or-later

# Clients reach the instance by the DNS name on its certificate.
resource "google_dns_managed_zone" "postgres" {
  name       = "${var.name}-postgres"
  dns_name   = "${local.host}."
  visibility = "private"

  private_visibility_config {
    networks {
      network_url = var.network
    }
  }

  # Fails closed: a zone for any other name would not match the certificate,
  # and an empty one would answer for every name in the VPC.
  lifecycle {
    precondition {
      condition     = endswith(local.host, ".sql.goog")
      error_message = "Cloud SQL returned no private services access DNS name ending in .sql.goog, so verify-full cannot pass."
    }
  }
}

resource "google_dns_record_set" "postgres" {
  managed_zone = google_dns_managed_zone.postgres.name
  name         = google_dns_managed_zone.postgres.dns_name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_sql_database_instance.main.private_ip_address]
}
