# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The cell's workloads on Cloud Run, the files bucket, the secrets they mount
# and an identity for each. Applied after the network and database roots,
# which it finds by name, never by reading their state.

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

  # The name on the server certificate, as the database root's host output.
  db_host = trimsuffix(one([
    for d in data.google_sql_database_instance.db.dns_names : d.name
    if d.connection_type == "PRIVATE_SERVICES_ACCESS"
  ]), ".")
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
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

data "google_compute_network" "vpc" {
  name = local.name
}

data "google_compute_subnetwork" "run" {
  name   = "${local.name}-run"
  region = local.region
}

data "google_sql_database_instance" "db" {
  name = "${local.name}-postgres"
}

data "google_sql_ca_certs" "db" {
  instance = data.google_sql_database_instance.db.name
}
