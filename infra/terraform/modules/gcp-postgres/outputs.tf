# SPDX-License-Identifier: AGPL-3.0-or-later

output "host" {
  description = "Host name to connect to; the server certificate names it."
  value       = trimsuffix(google_dns_record_set.postgres.name, ".")
}

output "private_ip" {
  description = "Private address of the instance."
  value       = google_sql_database_instance.main.private_ip_address
}

output "connection_name" {
  description = "Instance connection name (project:region:instance), for gcloud and logs."
  value       = google_sql_database_instance.main.connection_name
}

output "ca_certificate" {
  description = "Server CA certificates in PEM, for TPS_DB_TLS_CA. Public, not a secret."
  value       = join("", data.google_sql_ca_certs.main.certs[*].cert)
}
