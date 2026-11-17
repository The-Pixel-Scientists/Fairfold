# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The Google archive (ADR 0011): the monthly and yearly snapshots in a
# separate project, under per-object retention in locked mode. Production's
# job identity may add objects and lengthen their retention, list them and
# read the bucket's settings, and nothing else: it can neither read content,
# delete, overwrite, shorten or override retention, nor administer anything.

resource "google_project" "backup" {
  project_id          = var.backup_project.id
  name                = "${local.name}-backup"
  org_id              = var.backup_project.org_id
  billing_account     = var.backup_project.billing_account
  auto_create_network = false
  deletion_policy     = "PREVENT"
}

# Deleting the project needs this lien removed first, by its own reviewed change.
resource "google_resource_manager_lien" "backup" {
  parent       = "projects/${google_project.backup.number}"
  restrictions = ["resourcemanager.projects.delete"]
  origin       = "tps-backup"
  reason       = "Holds the locked off-site archive (ADR 0011)."
}

resource "google_project_service" "backup" {
  provider = google.backup

  service            = "storage.googleapis.com"
  disable_on_destroy = false

  depends_on = [google_project.backup]
}

# Every read and write of the archive is recorded in the backup project,
# out of production's reach.
resource "google_project_iam_audit_config" "storage" {
  provider = google.backup

  project = google_project.backup.project_id
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_storage_bucket" "archive" {
  provider = google.backup

  name                        = "${local.name}-archive-${var.backup_project.id}"
  location                    = local.region
  storage_class               = "ARCHIVE"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  enable_object_retention     = true
  force_destroy               = false

  # Old objects leave only this way, and locked retention holds back any
  # object whose date has not passed: 12 calendar months and a day at most
  # for a monthly snapshot, and later for anything a yearly one still needs.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 367
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.backup]
}

resource "google_project_iam_custom_role" "archive_writer" {
  provider = google.backup

  role_id     = replace("${local.name}-archive-writer", "-", "_")
  title       = "Archive writer"
  description = "Add objects to the archive and lengthen their retention. No read of content, no delete or overwrite."
  permissions = [
    "storage.buckets.get",
    "storage.objects.create",
    "storage.objects.list",
    "storage.objects.setRetention",
    "storage.objects.update",
  ]

  depends_on = [google_project_service.backup]
}

resource "google_storage_bucket_iam_member" "archive_writer" {
  provider = google.backup

  bucket = google_storage_bucket.archive.name
  role   = google_project_iam_custom_role.archive_writer.id
  member = google_service_account.job.member
}
