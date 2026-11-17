# SPDX-License-Identifier: AGPL-3.0-or-later

output "network" {
  description = "Network id."
  value       = module.network.network
}

output "subnet" {
  description = "Subnet id for Cloud Run's direct VPC egress."
  value       = module.network.subnet
}

output "egress_address" {
  description = "The one address outbound calls leave from, for providers that allow-list callers."
  value       = module.network.egress_address
}
