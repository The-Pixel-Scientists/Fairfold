# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Each is a GitHub variable the release workflow reads. None is a secret.

output "registry" {
  description = "TPS_RELEASE_REGISTRY."
  value       = "${local.region}-docker.pkg.dev/${var.project}/${google_artifact_registry_repository.release.repository_id}"
}

output "workload_identity_provider" {
  description = "TPS_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "publisher" {
  description = "TPS_PUBLISHER."
  value       = google_service_account.publisher.email
}

output "deployer" {
  description = "TPS_DEPLOYER."
  value       = google_service_account.deployer.email
}
