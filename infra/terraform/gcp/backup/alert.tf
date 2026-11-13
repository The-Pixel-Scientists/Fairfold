# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The missed-run alert (ADR 0011): the job prints one run record to standard
# output, which Cloud Run logs as JSON. A complete snapshot counts here; no
# such record for 26 hours, whether the run failed or never started, alerts
# the operators through the monitoring root's channel.

resource "google_logging_metric" "backup_complete" {
  name = replace("${local.tag}_complete", "-", "_")
  filter = join(" AND ", [
    "resource.type=\"cloud_run_job\"",
    "resource.labels.job_name=\"${google_cloud_run_v2_job.backup.name}\"",
    "logName=\"projects/${var.project}/logs/run.googleapis.com%2Fstdout\"",
    "jsonPayload.outcome=(\"ok\" OR \"already_complete\")",
  ])
}

resource "google_monitoring_alert_policy" "backup_missed" {
  display_name          = "${local.name} backup missed"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = [data.google_monitoring_notification_channel.operators.id]

  conditions {
    display_name = "No complete backup for 26 hours"

    condition_prometheus_query_language {
      query               = "absent_over_time(logging_googleapis_com:user_${google_logging_metric.backup_complete.name}{monitored_resource=\"cloud_run_job\"}[26h])"
      duration            = "0s"
      evaluation_interval = "300s"
    }
  }

  documentation {
    subject   = "No complete backup for 26 hours"
    content   = "The off-site backup job has logged no complete snapshot for 26 hours.\n\nRunbook: `docs/runbooks/restore.md`, \"Check the last backup\"."
    mime_type = "text/markdown"
  }

  alert_strategy {
    auto_close = "1800s"
  }
}
