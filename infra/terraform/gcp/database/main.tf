# SPDX-License-Identifier: AGPL-3.0-or-later

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

# Created by the network root. Looked up by name, so this root never reads
# that root's state.
data "google_compute_network" "vpc" {
  name = local.name
}

module "postgres" {
  source = "../../modules/gcp-postgres"

  project         = var.project
  name            = local.name
  region          = local.region
  network         = data.google_compute_network.vpc.id
  tier            = var.tier
  operators_group = var.operators_group
  labels = {
    environment = var.environment
    cell        = var.cell
  }
}
