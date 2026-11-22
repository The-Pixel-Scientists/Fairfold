# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Who the release workflow may act as. GitHub's OIDC token is exchanged for a
# federated token, which may impersonate one service account:
#
# - the publisher, from the `release` environment on a vX.Y.Z tag only,
#   pushes to the release repository and does nothing else;
# - the deployer, from the GitHub environment named for this environment
#   (staging, whose every run needs approval), reads the repository and
#   Cloud Run's operations. Its rights on each workload are granted where
#   the workload is made: the services root grants the roles below on each
#   one it deploys, and lets it act as its service account.
#
# The provider admits no token from any other repository, environment or ref.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${local.name}-github"
  display_name              = "GitHub release workflow"
  description               = "Tokens from the repository's release workflow."

  depends_on = [google_project_service.api]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.environment" = "assertion.environment"
  }

  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.repository_id}'",
    "(assertion.environment == '${var.environment}' || (assertion.environment == 'release' && assertion.ref_type == 'tag' && assertion.ref.matches('^refs/tags/v[0-9]+[.][0-9]+[.][0-9]+$')))",
  ])

  # The audience defaults to this provider's own name, which the workflow asks for.
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  principals = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment"
}

resource "google_service_account" "publisher" {
  account_id   = "${local.name}-publisher"
  display_name = "release publisher"
  description  = "Pushes signed release images to the release repository, and nothing else."

  depends_on = [google_project_service.api]
}

resource "google_service_account" "deployer" {
  account_id   = "${local.name}-deployer"
  display_name = "release deployer"
  description  = "Rolls the release images out to this cell's workloads, and nothing else."

  depends_on = [google_project_service.api]
}

resource "google_service_account_iam_member" "publisher" {
  service_account_id = google_service_account.publisher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.principals}/release"
}

resource "google_service_account_iam_member" "deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.principals}/${var.environment}"
}

resource "google_artifact_registry_repository_iam_member" "publisher" {
  repository = google_artifact_registry_repository.release.name
  location   = google_artifact_registry_repository.release.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.publisher.member
}

resource "google_artifact_registry_repository_iam_member" "deployer" {
  repository = google_artifact_registry_repository.release.name
  location   = google_artifact_registry_repository.release.location
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.deployer.member
}

# Granted on each workload by the root that makes it, never on the project.
resource "google_project_iam_custom_role" "deploy" {
  role_id     = replace("${local.name}-deploy", "-", "_")
  title       = "Deploy a workload"
  description = "Read a Cloud Run workload and change its image."
  permissions = [
    "run.jobs.get",
    "run.jobs.update",
    "run.services.get",
    "run.services.update",
    "run.workerPools.get",
    "run.workerPools.update",
  ]
}

# Granted on the migrate job alone.
resource "google_project_iam_custom_role" "run_job" {
  role_id     = replace("${local.name}-run-job", "-", "_")
  title       = "Run a job"
  description = "Run a Cloud Run job and follow its executions."
  permissions = ["run.executions.get", "run.jobs.run"]
}

# An operation has no IAM of its own, so this one permission is granted on
# the project. It shows an operation's progress, not a workload's settings.
resource "google_project_iam_custom_role" "read_operations" {
  role_id     = replace("${local.name}-read-operations", "-", "_")
  title       = "Read Cloud Run operations"
  description = "Follow a Cloud Run change until it finishes."
  permissions = ["run.operations.get"]
}

resource "google_project_iam_member" "deployer_operations" {
  project = var.project
  role    = google_project_iam_custom_role.read_operations.id
  member  = google_service_account.deployer.member
}
