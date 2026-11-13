# Monitoring root

The cell's dashboards and alert policies in Cloud Monitoring, built from the
portable definitions in [`infra/observability/`](../../../observability/)
with `file()`, and the email channel every alert goes to. Change a dashboard
or alert there, never here.

| Resource                                 | Built from                              |
| ---------------------------------------- | --------------------------------------- |
| `google_monitoring_alert_policy.rule`    | One per rule in `alerts/tps.rules.yaml` |
| `google_monitoring_dashboard.dashboard`  | One per file in `dashboards/`           |
| `google_monitoring_notification_channel` | `TF_VAR_alert_email`                    |

Each policy's condition is the rule's PromQL, unchanged. The rule's `for`
becomes the condition's duration, its labels the policy's labels and
severity, and its annotations the policy's documentation, which names the
runbook. `tests/monitoring.tftest.hcl` fails if any rule or dashboard file
has no copy here.

## Gaps from the portable definitions

- Dashboard tiles keep each panel's title, place and queries, but not its
  legend names or units: Cloud Monitoring labels lines by their series.
- Alert text has no templates, so a policy names the queue or limit only
  through the incident's labels.

Every rule is expressed in PromQL, so no condition is written in Terraform.

## Before you apply

- The services root is applied.
- Metrics reach Cloud Monitoring under their Prometheus names (for example
  `tps_queue_depth`, `http_server_request_duration_seconds_bucket`), which is
  how the queries name them. The Collector that sends them, inside the
  cell, comes with the first rollout.

Inputs come from the environment, as for the other roots. The alert mailbox
is never written to the repository:

```sh
export TF_VAR_project=<project id> TF_VAR_environment=staging TF_VAR_cell=uk
export TF_VAR_alert_email=<operators' mailbox>
tofu -chdir=infra/terraform/gcp/monitoring init \
  -backend-config="bucket=<state bucket>" \
  -backend-config="prefix=$TF_VAR_environment/$TF_VAR_cell/monitoring"
tofu -chdir=infra/terraform/gcp/monitoring apply
```

## Rolling back

Re-apply the previous commit. Dashboards and policies hold no data, so
destroying and re-creating them loses only incident history.
