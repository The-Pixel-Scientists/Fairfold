# SPDX-License-Identifier: AGPL-3.0-or-later

output "host" {
  description = "Host name for TPS_DB_HOST; the server certificate names it."
  value       = module.postgres.host
}

output "private_ip" {
  description = "Private address of the instance."
  value       = module.postgres.private_ip
}

output "connection_name" {
  description = "Instance connection name (project:region:instance), for gcloud and logs."
  value       = module.postgres.connection_name
}

output "ca_certificate" {
  description = "Server CA certificates in PEM, for TPS_DB_TLS_CA. Public, not a secret."
  value       = module.postgres.ca_certificate
}
