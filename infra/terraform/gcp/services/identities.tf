# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One service account per workload, used by nothing else, and one per storage
# key purpose (ADR 0030), whose HMAC key is that purpose's S3 key pair. None
# holds a project-level role: each is granted only on the secrets and bucket
# it uses (secrets.tf, storage.tf). Logs reach Cloud Logging from Cloud Run
# itself, and the database is reached by password over TLS, so no logging or
# Cloud SQL role is needed.

locals {
  workloads = ["api", "worker", "migrate", "console", "portal"]
}

resource "google_service_account" "workload" {
  for_each = toset(local.workloads)

  account_id   = "${local.name}-${each.key}"
  display_name = "${each.key} workload"
  description  = "Runs the ${each.key} workload on Cloud Run, and nothing else."

  depends_on = [google_project_service.api]
}

resource "google_service_account" "storage" {
  for_each = toset(["write", "read", "scanner", "removal"])

  account_id   = "${local.name}-st-${each.key}"
  display_name = "${each.key} storage key"
  description  = "Holds the ${each.key} HMAC key for the files bucket. No workload runs as it."

  depends_on = [google_project_service.api]
}

# What the removal key does beyond reading: list and delete objects, granted
# under clean/ and withheld/ only (storage.tf). HEAD needs objects.get.
resource "google_project_iam_custom_role" "files_removal" {
  role_id     = replace("${local.name}-files-removal", "-", "_")
  title       = "Files removal"
  description = "List, head and delete objects in the files bucket."
  permissions = ["storage.objects.delete", "storage.objects.get", "storage.objects.list"]
}

# The sweep reads the bucket's versioning before it deletes anything (ADR 0030).
resource "google_project_iam_custom_role" "files_bucket_reader" {
  role_id     = replace("${local.name}-files-bucket-reader", "-", "_")
  title       = "Files bucket reader"
  description = "Read the files bucket's settings, not its objects."
  permissions = ["storage.buckets.get"]
}
