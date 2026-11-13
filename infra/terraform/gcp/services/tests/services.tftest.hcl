# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Applies this root against a mocked provider, so no Google account is used,
# and checks the rules a reviewer would otherwise check by eye. Run with:
# tofu -chdir=infra/terraform/gcp/services test

mock_provider "google" {
  # IAM members are validated even when mocked, so a random string won't do.
  mock_resource "google_service_account" {
    defaults = {
      email  = "x@tps-test.iam.gserviceaccount.com"
      member = "serviceAccount:x@tps-test.iam.gserviceaccount.com"
    }
  }

  mock_data "google_sql_database_instance" {
    defaults = {
      dns_names = [
        {
          name            = "a1b2c3d4e5f6.1a2b3c4d5e6f.europe-west2.sql.goog."
          connection_type = "PRIVATE_SERVICES_ACCESS"
          dns_scope       = "INSTANCE"
        },
      ]
    }
  }
}

variables {
  project     = "tps-test"
  environment = "staging"
  cell        = "uk"
  images = {
    api     = "europe-west2-docker.pkg.dev/tps-test/release/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    console = "europe-west2-docker.pkg.dev/tps-test/release/console@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    portal  = "europe-west2-docker.pkg.dev/tps-test/release/portal@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
  console_origin  = "https://console.example.org"
  portal_origin   = "https://grants.example.org"
  api_trust_proxy = "35.191.0.0/16,130.211.0.0/22"
  clamd           = { host = "clamd.internal", port = 3310 }
  smtp            = { host = "smtp.example.org", port = 587, tls = "starttls", user = "relay", from = "grants@example.org" }
}

run "workloads_are_private_and_route_through_the_vpc" {
  assert {
    condition = alltrue([
      for service in google_cloud_run_v2_service.service :
      service.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" && service.default_uri_disabled
    ])
    error_message = "api, console and portal must take traffic only from the load balancer."
  }

  assert {
    condition = alltrue(concat(
      [for service in google_cloud_run_v2_service.service : service.template[0].vpc_access[0].egress == "ALL_TRAFFIC"],
      [google_cloud_run_v2_worker_pool.worker.template[0].vpc_access[0].egress == "ALL_TRAFFIC"],
      [google_cloud_run_v2_job.migrate.template[0].template[0].vpc_access[0].egress == "ALL_TRAFFIC"],
    ))
    error_message = "Every workload must send all its traffic through the VPC."
  }

  assert {
    condition     = google_cloud_run_v2_worker_pool.worker.scaling[0].manual_instance_count == 1
    error_message = "The worker must always run one instance."
  }
}

run "only_the_api_worker_and_migrate_job_read_secrets" {
  assert {
    condition = alltrue([
      for key in keys(google_secret_manager_secret_iam_member.reader) :
      !endswith(key, "/console") && !endswith(key, "/portal")
    ])
    error_message = "The console and portal must hold no secret."
  }

  assert {
    condition = alltrue([
      for key in keys(google_secret_manager_secret_iam_member.reader) :
      !startswith(key, "db-migrator-password/") || key == "db-migrator-password/migrate"
    ])
    error_message = "Only the migrate job may read the migrator's password."
  }

  assert {
    condition     = !contains(keys(google_secret_manager_secret_iam_member.reader), "storage-removal/api")
    error_message = "The API must never hold the removal key (ADR 0030)."
  }
}

run "files_bucket_keeps_one_private_copy" {
  assert {
    condition = (
      google_storage_bucket.files.public_access_prevention == "enforced" &&
      google_storage_bucket.files.uniform_bucket_level_access &&
      !google_storage_bucket.files.versioning[0].enabled &&
      google_storage_bucket.files.soft_delete_policy[0].retention_duration_seconds == 0
    )
    error_message = "The files bucket must be private, unversioned and without soft delete (ADR 0030)."
  }

  assert {
    condition = alltrue([
      for grant in google_storage_bucket_iam_member.files : length(grant.condition) == 1
    ])
    error_message = "Every object grant on the files bucket must be limited to its prefixes."
  }
}

run "an_image_by_tag_is_refused" {
  command = plan

  variables {
    images = {
      api     = "europe-west2-docker.pkg.dev/tps-test/release/api:latest"
      console = "europe-west2-docker.pkg.dev/tps-test/release/console:latest"
      portal  = "europe-west2-docker.pkg.dev/tps-test/release/portal:latest"
    }
  }

  expect_failures = [var.images]
}
