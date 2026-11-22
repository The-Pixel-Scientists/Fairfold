# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The release pipeline's Google side (.github/workflows/release.yml): the
# registry the images are pushed to, and the federation that lets the
# workflow sign in with GitHub's OIDC token, so no key is ever stored.
# Applied straight after the state root, before the first tag. The services
# root grants the deployer its rights on the workloads it deploys, finding it
# here by name; the backup root grants it none.

terraform {
  required_version = "1.13.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.46.2"
    }
  }

  # bucket and prefix come from -backend-config (see the README).
  backend "gcs" {}
}

locals {
  name   = "tps-${var.environment}-${var.cell}"
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

resource "google_project_service" "api" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# Tags are not immutable: cosign writes each digest's signature and both
# attestations under tags of their own, and the second attestation updates
# the first's. Workloads always run an image by digest.
resource "google_artifact_registry_repository" "release" {
  repository_id = "${local.name}-release"
  location      = local.region
  format        = "DOCKER"
  description   = "Signed release images, by digest."

  depends_on = [google_project_service.api]
}
