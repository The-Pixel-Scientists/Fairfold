# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Cloud SQL for PostgreSQL 16: private address only, encrypted connections
# only, backups and point-in-time recovery as ADR 0011 sets them, and no
# password anywhere in state. App roles and their passwords come from the
# roles script, run by a member of the operators' group (access.tf).

resource "google_sql_database_instance" "main" {
  name                = "${var.name}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier                        = var.tier
    edition                     = "ENTERPRISE"
    availability_type           = "REGIONAL"
    deletion_protection_enabled = true
    user_labels                 = var.labels

    backup_configuration {
      enabled                        = true
      location                       = var.region
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 35
        retention_unit   = "COUNT"
      }
    }

    # The Google-managed CAS mode issues server certificates that name the
    # instance's private services access DNS name (local.host), so
    # verify-full can check the host name.
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network
      ssl_mode        = "ENCRYPTED_ONLY"
      server_ca_mode  = "GOOGLE_MANAGED_CAS_CA"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
    database_flags {
      name  = "log_checkpoints"
      value = "on"
    }
    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
    database_flags {
      name  = "log_temp_files"
      value = "0"
    }
    # Statement text and error detail can carry personal data, so neither is
    # logged: no statement by duration or on error, and errors keep only
    # their message, without DETAIL, HINT, QUERY or CONTEXT.
    database_flags {
      name  = "log_min_duration_statement"
      value = "-1"
    }
    database_flags {
      name  = "log_min_error_statement"
      value = "panic"
    }
    database_flags {
      name  = "log_error_verbosity"
      value = "terse"
    }

    insights_config {
      query_insights_enabled = false
    }
  }
}

data "google_sql_ca_certs" "main" {
  instance = google_sql_database_instance.main.name
}

# The name Cloud SQL gives the instance for private services access. Empty if
# it is missing, which the DNS zone's precondition refuses.
locals {
  host = try(trimsuffix(one([
    for d in google_sql_database_instance.main.dns_names : d.name
    if d.connection_type == "PRIVATE_SERVICES_ACCESS"
  ]), "."), "")
}
