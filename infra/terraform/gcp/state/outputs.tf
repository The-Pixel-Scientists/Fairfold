# SPDX-License-Identifier: AGPL-3.0-or-later

output "bucket" {
  description = "Pass to the other roots as -backend-config=bucket=<value>."
  value       = google_storage_bucket.state.name
}
