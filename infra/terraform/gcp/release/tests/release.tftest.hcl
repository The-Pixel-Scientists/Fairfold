# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Applies this root against a mocked provider, so no Google account is used,
# and checks the rules a reviewer would otherwise check by eye. Run with:
# tofu -chdir=infra/terraform/gcp/release test

mock_provider "google" {
  # IAM members are validated even when mocked, so a random string won't do.
  mock_resource "google_service_account" {
    defaults = {
      name   = "projects/tps-test/serviceAccounts/x@tps-test.iam.gserviceaccount.com"
      email  = "x@tps-test.iam.gserviceaccount.com"
      member = "serviceAccount:x@tps-test.iam.gserviceaccount.com"
    }
  }

  mock_resource "google_iam_workload_identity_pool" {
    defaults = {
      name = "projects/123456789012/locations/global/workloadIdentityPools/tps-staging-uk-github"
    }
  }
}

variables {
  project       = "tps-test"
  environment   = "staging"
  cell          = "uk"
  repository_id = "123456789"
}

run "only_this_repository_signs_in_and_release_only_from_a_tag" {
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.oidc[0].issuer_uri == "https://token.actions.githubusercontent.com"
    error_message = "The provider must trust GitHub's OIDC issuer alone."
  }

  assert {
    condition = (
      strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_id == '123456789'") &&
      strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.environment == 'release' && assertion.ref_type == 'tag'")
    )
    error_message = "The provider must admit this repository only, and the release environment only on a tag."
  }
}

run "each_account_is_impersonated_from_its_own_environment" {
  assert {
    condition     = endswith(google_service_account_iam_member.publisher.member, "/attribute.environment/release")
    error_message = "Only the release environment may act as the publisher."
  }

  assert {
    condition     = endswith(google_service_account_iam_member.deployer.member, "/attribute.environment/staging")
    error_message = "Only the staging environment may act as staging's deployer."
  }
}

run "rights_are_held_on_the_repository_not_the_project" {
  assert {
    condition = (
      google_artifact_registry_repository_iam_member.publisher.role == "roles/artifactregistry.writer" &&
      google_artifact_registry_repository_iam_member.deployer.role == "roles/artifactregistry.reader"
    )
    error_message = "The publisher may write to the repository and the deployer only read it."
  }

  assert {
    condition     = google_project_iam_custom_role.read_operations.permissions == toset(["run.operations.get"])
    error_message = "The deployer's one project-level right must be reading Cloud Run's operations."
  }

  assert {
    condition = !anytrue([
      for permission in google_project_iam_custom_role.deploy.permissions :
      endswith(permission, "IamPolicy") || endswith(permission, ".create") || endswith(permission, ".delete")
    ])
    error_message = "Deploying must not create, delete or change the access of a workload."
  }
}

run "a_repository_name_is_refused" {
  command = plan

  variables {
    repository_id = "owner/repository"
  }

  expect_failures = [var.repository_id]
}
