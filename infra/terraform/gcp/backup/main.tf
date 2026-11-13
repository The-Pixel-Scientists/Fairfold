# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The off-site backup (ADR 0011): the nightly job in the cell's project, and
# the Google archive in a separate backup project that production can write
# to but never delete from. Applied after the network, database, services
# and monitoring roots, which it finds by name, never by reading their state.

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

  # The services root's files bucket.
  files_bucket = "${local.name}-files-${var.project}"
}

provider "google" {
  project = var.project
  region  = local.region
  default_labels = {
    environment = var.environment
    cell        = var.cell
  }
}

provider "google" {
  alias   = "backup"
  project = var.backup_project.id
  region  = local.region
  default_labels = {
    environment = var.environment
    cell        = var.cell
  }
}

resource "google_project_service" "api" {
  service            = "cloudscheduler.googleapis.com"
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

data "google_monitoring_notification_channel" "operators" {
  display_name = "${local.name} operators"
}
