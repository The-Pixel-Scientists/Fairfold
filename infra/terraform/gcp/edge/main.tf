# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The cell's front door: an external Application Load Balancer that maps the
# self-hosted proxy's rules (ADR 0030) onto Google Cloud, with Google-managed
# certificates, HTTPS only, and Cloud Armor's rate limits on the API.
# Applied after the services root, whose services it finds by name.

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

  # The one host each web app answers on; the API sits under /api/ on both.
  hosts = {
    console = trimprefix(var.console_origin, "https://")
    portal  = trimprefix(var.portal_origin, "https://")
  }

  # Google's front-end ranges, from which every request reaches Cloud Run.
  front_ends = ["35.191.0.0/16", "130.211.0.0/22"]
}

provider "google" {
  project = var.project
  region  = local.region
  default_labels = {
    environment = var.environment
    cell        = var.cell
  }
}
