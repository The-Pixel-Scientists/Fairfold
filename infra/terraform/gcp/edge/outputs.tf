# SPDX-License-Identifier: AGPL-3.0-or-later

output "address" {
  description = "Point the console and portal hosts' A records here."
  value       = google_compute_global_address.edge.address
}

output "api_trust_proxy" {
  description = "TPS_API_TRUST_PROXY for the services root: this address and Google's front-end ranges (ADR 0030)."
  value       = join(",", concat([google_compute_global_address.edge.address], local.front_ends))
}
