# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The cell's dashboards, alert policies and alert email channel in Cloud
# Monitoring. Every dashboard and alert is built from the portable
# definitions in infra/observability/, read here with file(), so the two
# cannot drift. Applied after the services root.

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
  name          = "tps-${var.environment}-${var.cell}"
  region        = { uk = "europe-west2" }[var.cell]
  observability = "${path.module}/../../../observability"

  rules_file = "${local.observability}/alerts/tps.rules.yaml"
  groups     = yamldecode(file(local.rules_file)).groups
  rules = merge([
    for group in local.groups : {
      for rule in group.rules : rule.alert => merge(rule, { group = group.name })
    }
  ]...)

  dashboards = {
    for file in fileset("${local.observability}/dashboards", "*.json") :
    trimsuffix(file, ".json") => jsondecode(file("${local.observability}/dashboards/${file}"))
  }
}

provider "google" {
  project = var.project
  region  = local.region
  default_labels = {
    environment = var.environment
    cell        = var.cell
  }
}

resource "google_project_service" "monitoring" {
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}
