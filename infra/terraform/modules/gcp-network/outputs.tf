# SPDX-License-Identifier: AGPL-3.0-or-later

output "network" {
  description = "Network id."
  value       = google_compute_network.vpc.id
}

output "subnet" {
  description = "Subnet id for Cloud Run's direct VPC egress."
  value       = google_compute_subnetwork.run.id
}

output "egress_address" {
  description = "The one address outbound calls leave from."
  value       = google_compute_address.egress.address
}
