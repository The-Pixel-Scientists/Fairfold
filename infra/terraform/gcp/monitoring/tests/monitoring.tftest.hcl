# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Plans this root against a mocked provider, so no Google account is used,
# and checks that every portable alert and dashboard has its Google copy.
# Run with: tofu -chdir=infra/terraform/gcp/monitoring test

mock_provider "google" {}

variables {
  project     = "tps-test"
  environment = "staging"
  cell        = "uk"
  alert_email = "operators@example.org"
}

run "every_portable_definition_has_a_google_copy" {
  command = plan

  # Read the alert names from the rule file's text, apart from the
  # yamldecode() the policies are built from, so a rule dropped on the way
  # fails here.
  assert {
    condition = (
      sort(keys(google_monitoring_alert_policy.rule)) ==
      sort(flatten(regexall("(?m)^\\s*- alert: (\\w+)", file("../../../observability/alerts/tps.rules.yaml"))))
    )
    error_message = "Each alert in infra/observability/alerts/tps.rules.yaml must have exactly one alert policy."
  }

  assert {
    condition = (
      sort(keys(google_monitoring_dashboard.dashboard)) ==
      sort([for file in fileset("../../../observability/dashboards", "*.json") : trimsuffix(file, ".json")])
    )
    error_message = "Each file in infra/observability/dashboards/ must have exactly one dashboard."
  }

  assert {
    condition = alltrue([
      for name, policy in google_monitoring_alert_policy.rule :
      policy.conditions[0].condition_prometheus_query_language[0].query == {
        for rule in flatten(yamldecode(file("../../../observability/alerts/tps.rules.yaml")).groups[*].rules) :
        rule.alert => rule.expr
      }[name]
    ])
    error_message = "Each alert policy must use its rule's PromQL unchanged."
  }

  assert {
    condition = alltrue([
      for policy in google_monitoring_alert_policy.rule :
      length(regexall("Runbook: `docs/runbooks/[a-z-]+\\.md`", policy.documentation[0].content)) == 1
    ])
    error_message = "Each alert policy must name its runbook."
  }

  assert {
    condition     = google_monitoring_alert_policy.rule["AuthAuditCopyPending"].conditions[0].condition_prometheus_query_language[0].duration == "0s"
    error_message = "The audit-copy alert must fire as soon as a copy is over 10 minutes old."
  }

  assert {
    condition     = google_monitoring_alert_policy.rule["QueueDepthHigh"].conditions[0].condition_prometheus_query_language[0].duration == "900s"
    error_message = "A rule's `for` must become the policy's duration."
  }
}
