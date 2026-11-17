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

module "network" {
  source = "../../modules/gcp-network"

  name         = local.name
  region       = local.region
  subnet_range = "10.10.0.0/22"
}
