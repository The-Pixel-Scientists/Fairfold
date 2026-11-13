# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Applies this root against mocked providers, so no Google account is used,
# and checks the rules a reviewer would otherwise check by eye. Run with:
# tofu -chdir=infra/terraform/gcp/backup test

mock_provider "google" {
  # IAM members are validated even when mocked, so a random string won't do.
  mock_resource "google_service_account" {
    defaults = {
      email  = "x@tps-test.iam.gserviceaccount.com"
      member = "serviceAccount:x@tps-test.iam.gserviceaccount.com"
    }
  }

  mock_resource "google_project" {
    defaults = {
      number = "123456789012"
    }
  }

  mock_data "google_sql_database_instance" {
    defaults = {
      private_ip_address = "10.20.0.3"
      dns_names = [
        {
          name            = "a1b2c3d4e5f6.1a2b3c4d5e6f.europe-west2.sql.goog."
          connection_type = "PRIVATE_SERVICES_ACCESS"
          dns_scope       = "INSTANCE"
        },
      ]
    }
  }

  mock_data "google_dns_managed_zone" {
    defaults = {
      dns_name   = "googleapis.com."
      visibility = "private"
    }
  }
}

mock_provider "google" {
  alias = "backup"
}

variables {
  project     = "tps-test"
  environment = "staging"
  cell        = "uk"
  backup_project = {
    id              = "tps-test-backup"
    org_id          = "123456789"
    billing_account = "000000-000000-000000"
  }
  image = "europe-west2-docker.pkg.dev/tps-test/release/backup@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  backup_store = {
    endpoint = "https://s3.example.org"
    region   = "uk-1"
    bucket   = "tps-staging-uk"
    ranges   = ["192.0.2.0/24"]
  }
  key_id = "2026-11"
}

run "archive_is_locked_private_and_write_only" {
  assert {
    condition = (
      google_storage_bucket.archive.storage_class == "ARCHIVE" &&
      google_storage_bucket.archive.location == "europe-west2" &&
      google_storage_bucket.archive.uniform_bucket_level_access &&
      google_storage_bucket.archive.public_access_prevention == "enforced" &&
      google_storage_bucket.archive.enable_object_retention
    )
    error_message = "The archive must be Archive class in London, private, with object retention on."
  }

  assert {
    condition = !anytrue([
      for permission in google_project_iam_custom_role.archive_writer.permissions :
      permission == "storage.objects.get" || strcontains(permission, "delete") ||
      strcontains(permission, "override") || strcontains(permission, "IamPolicy")
    ])
    error_message = "Production must not read, delete, overwrite or override retention in the archive, or change its permissions."
  }

  assert {
    condition     = google_resource_manager_lien.backup.restrictions == tolist(["resourcemanager.projects.delete"])
    error_message = "The backup project must carry a lien against deletion."
  }
}

run "job_is_private_and_fenced" {
  assert {
    condition = (
      google_cloud_run_v2_job.backup.template[0].template[0].vpc_access[0].egress == "ALL_TRAFFIC" &&
      google_cloud_run_v2_job.backup.template[0].template[0].vpc_access[0].network_interfaces[0].tags == tolist(["tps-staging-uk-backup"])
    )
    error_message = "The job must send all its traffic through the VPC, under its firewall tag."
  }

  assert {
    condition = alltrue([
      for rule in google_compute_firewall.allow_egress :
      rule.priority < google_compute_firewall.deny_egress.priority && !contains(rule.destination_ranges, "0.0.0.0/0")
    ])
    error_message = "Each egress allowance must name its ranges and come before the deny rule."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.backup.time_zone == "Etc/UTC" &&
      google_cloud_scheduler_job.backup.retry_config[0].retry_count == 0
    )
    error_message = "The job must be scheduled in UTC and never started twice by a retry."
  }
}

run "an_image_by_tag_is_refused" {
  command = plan

  variables {
    image = "europe-west2-docker.pkg.dev/tps-test/release/backup:latest"
  }

  expect_failures = [var.image]
}

run "an_open_egress_range_is_refused" {
  command = plan

  variables {
    backup_store = {
      endpoint = "https://s3.example.org"
      region   = "uk-1"
      bucket   = "tps-staging-uk"
      ranges   = ["0.0.0.0/0"]
    }
  }

  expect_failures = [var.backup_store]
}

run "the_cells_own_project_is_refused" {
  command = plan

  variables {
    backup_project = {
      id              = "tps-test"
      org_id          = "123456789"
      billing_account = "000000-000000-000000"
    }
  }

  expect_failures = [var.backup_project]
}

run "a_public_googleapis_zone_is_refused" {
  command = plan

  override_data {
    target = data.google_dns_managed_zone.googleapis
    values = {
      dns_name   = "googleapis.com."
      visibility = "public"
    }
  }

  expect_failures = [data.google_dns_managed_zone.googleapis]
}
