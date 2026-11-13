# SPDX-License-Identifier: AGPL-3.0-or-later

output "archive_bucket" {
  description = "The Google archive bucket in the backup project."
  value       = google_storage_bucket.archive.name
}

output "job_service_account" {
  description = "The backup job's identity, the only production identity the archive admits."
  value       = google_service_account.job.email
}
