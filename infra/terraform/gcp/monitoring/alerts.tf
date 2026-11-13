# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One alert policy per rule in infra/observability/alerts/tps.rules.yaml,
# with the rule's PromQL as its condition and its annotations as the text.

resource "google_monitoring_notification_channel" "email" {
  display_name = "${local.name} operators"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "rule" {
  for_each = local.rules

  display_name          = "${local.name} ${each.key}"
  combiner              = "OR"
  severity              = upper(each.value.labels.severity)
  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = each.value.annotations.summary

    condition_prometheus_query_language {
      query               = each.value.expr
      duration            = "${tonumber(trimsuffix(try(each.value["for"], "0m"), "m")) * 60}s"
      evaluation_interval = "60s"
      rule_group          = each.value.group
      alert_rule          = each.key
      labels              = each.value.labels
    }
  }

  documentation {
    subject   = each.value.annotations.summary
    content   = "${each.value.annotations.description}\n\nRunbook: `${each.value.annotations.runbook}`"
    mime_type = "text/markdown"
  }

  alert_strategy {
    auto_close = "1800s"
  }

  lifecycle {
    precondition {
      condition     = can(regex("^[0-9]+m$", try(each.value["for"], "0m")))
      error_message = "${each.key}: write `for` in whole minutes, such as 15m."
    }
    precondition {
      condition     = contains(["critical", "warning"], each.value.labels.severity)
      error_message = "${each.key}: severity must be critical or warning."
    }
    precondition {
      condition     = can(regex("^docs/runbooks/[a-z-]+\\.md$", each.value.annotations.runbook))
      error_message = "${each.key}: runbook must name a file in docs/runbooks/."
    }
  }

  depends_on = [google_project_service.monitoring]
}
