# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The files bucket (ADR 0047, ADR 0030). The apps speak S3 (rule 1), so they
# reach it through Cloud Storage's S3-compatible API with one HMAC key per
# purpose. A key has its service account's rights, so each purpose has its
# own account, granted on this bucket only and only under its prefixes, as
# the stack's SeaweedFS identities are (scripts/stack.ts).
#
# No versioning and no soft delete: a delete must remove the only copy, and
# the sweep refuses to run on a versioned bucket (ADR 0030, ADR 0011). The
# off-site snapshot is the only second copy of a file.

resource "google_storage_bucket" "files" {
  name                        = "${local.name}-files-${var.project}"
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.api]
}

locals {
  objects = "projects/_/buckets/${google_storage_bucket.files.name}/objects"

  # Who may do what, and where. list admits a list request whose
  # prefix starts with one of them; a list's resource is the bucket, so the
  # object prefixes alone never admit one.
  file_grants = {
    write_clean = {
      account  = "write"
      role     = "roles/storage.objectCreator"
      prefixes = ["clean/"]
      list     = []
    }
    read_clean = {
      account  = "read"
      role     = "roles/storage.objectViewer"
      prefixes = ["clean/"]
      list     = []
    }
    scanner_read = {
      account  = "scanner"
      role     = "roles/storage.objectViewer"
      prefixes = ["clean/", "withheld/"]
      list     = []
    }
    scanner_write = {
      account  = "scanner"
      role     = "roles/storage.objectCreator"
      prefixes = ["withheld/"]
      list     = []
    }
    removal = {
      account  = "removal"
      role     = google_project_iam_custom_role.files_removal.id
      prefixes = ["clean/", "withheld/"]
      list     = ["clean/", "withheld/"]
    }
  }
}

resource "google_storage_bucket_iam_member" "files" {
  for_each = local.file_grants

  bucket = google_storage_bucket.files.name
  role   = each.value.role
  member = google_service_account.storage[each.value.account].member

  condition {
    title = "${join(" and ", each.value.prefixes)} only"
    expression = join(" || ", concat(
      [for prefix in each.value.prefixes : "resource.name.startsWith(\"${local.objects}/${prefix}\")"],
      [for prefix in each.value.list : "api.getAttribute(\"storage.googleapis.com/objectListPrefix\", \"\").startsWith(\"${prefix}\")"],
    ))
  }
}

resource "google_storage_bucket_iam_member" "removal_versioning" {
  bucket = google_storage_bucket.files.name
  role   = google_project_iam_custom_role.files_bucket_reader.id
  member = google_service_account.storage["removal"].member
}

resource "google_storage_hmac_key" "files" {
  for_each = google_service_account.storage

  service_account_email = each.value.email
}
