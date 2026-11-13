# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Plans the Cloud SQL module against a mocked provider, so no Google account
# is used. Run with: tofu -chdir=infra/terraform/gcp/database test

mock_provider "google" {
  mock_resource "google_sql_database_instance" {
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
  project         = "tps-test"
  name            = "tps-staging-uk"
  region          = "europe-west2"
  network         = "projects/tps-test/global/networks/tps-staging-uk"
  tier            = "db-custom-1-3840"
  operators_group = "operators@example.org"
  labels          = { environment = "staging", cell = "uk" }
}

run "host_is_the_private_services_access_name" {
  command = plan

  module {
    source = "../../modules/gcp-postgres"
  }

  assert {
    condition     = output.host == "a1b2c3d4e5f6.1a2b3c4d5e6f.europe-west2.sql.goog"
    error_message = "host must be the instance's private services access DNS name."
  }
}

run "no_private_services_access_name_fails_before_the_zone" {
  command = plan

  module {
    source = "../../modules/gcp-postgres"
  }

  override_resource {
    target = google_sql_database_instance.main
    values = {
      dns_names = [
        {
          name            = "a1b2c3d4e5f6.1a2b3c4d5e6f.europe-west2.sql.goog."
          connection_type = "PRIVATE_SERVICE_CONNECT"
          dns_scope       = "INSTANCE"
        },
      ]
    }
  }

  expect_failures = [google_dns_managed_zone.postgres]
}

run "statements_and_error_detail_are_not_logged" {
  command = plan

  module {
    source = "../../modules/gcp-postgres"
  }

  assert {
    condition = length(setintersection(
      [for f in google_sql_database_instance.main.settings[0].database_flags : "${f.name}=${f.value}"],
      ["log_min_duration_statement=-1", "log_min_error_statement=panic", "log_error_verbosity=terse"],
    )) == 3
    error_message = "Statement text and error detail must not reach the logs."
  }
}
