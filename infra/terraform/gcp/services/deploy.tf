# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The release pipeline's deployer (the release root) may change the image of
# api, console, portal, the worker and the migrate job, run the migrate job,
# and act as those five workloads' service accounts, which Cloud Run needs to
# deploy them. Nothing more, and nothing on the tenant-create job.

data "google_service_account" "deployer" {
  account_id = "${local.name}-deployer"
}

locals {
  deployer    = "serviceAccount:${data.google_service_account.deployer.email}"
  deploy_role = "projects/${var.project}/roles/${replace("${local.name}-deploy", "-", "_")}"
  run_role    = "projects/${var.project}/roles/${replace("${local.name}-run-job", "-", "_")}"
  deployed    = toset(["api", "worker", "migrate", "console", "portal"])
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  for_each = google_cloud_run_v2_service.service

  name     = each.value.name
  location = each.value.location
  role     = local.deploy_role
  member   = local.deployer
}

resource "google_cloud_run_v2_worker_pool_iam_member" "deployer" {
  name     = google_cloud_run_v2_worker_pool.worker.name
  location = google_cloud_run_v2_worker_pool.worker.location
  role     = local.deploy_role
  member   = local.deployer
}

resource "google_cloud_run_v2_job_iam_member" "deployer" {
  for_each = { deploy = local.deploy_role, run = local.run_role }

  name     = google_cloud_run_v2_job.migrate.name
  location = google_cloud_run_v2_job.migrate.location
  role     = each.value
  member   = local.deployer
}

resource "google_service_account_iam_member" "deployer" {
  for_each = local.deployed

  service_account_id = google_service_account.workload[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer
}
