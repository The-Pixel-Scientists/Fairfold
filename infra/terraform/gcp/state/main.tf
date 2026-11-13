# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The bucket that holds every other root's state. This root keeps its own
# state locally, outside the repository (see the README): it holds one bucket
# and can be re-imported if lost.

terraform {
  required_version = "1.13.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.46.2"
    }
  }
}

locals {
  region = { uk = "europe-west2" }[var.cell]
}

provider "google" {
  project = var.project
  region  = local.region
  default_labels = {
    environment = var.environment
    cell        = var.cell
  }
}

resource "google_storage_bucket" "state" {
  name                        = "tps-${var.environment}-${var.cell}-state-${var.project}"
  location                    = local.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Older state versions are kept long enough to recover from a bad apply
  # found late, and no longer.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 90
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
