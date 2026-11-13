# Observability

Dashboards and alerts for one cell, in open formats any
OpenTelemetry-compatible backend can load. They are the source of truth: the
managed service builds its own dashboards and alerts from these files
(`infra/terraform/`), so a self-hoster sees the same signals.

| Path                    | What it is                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `collector/config.yaml` | An OpenTelemetry Collector configuration, core components only                              |
| `alerts/tps.rules.yaml` | Alert rules in Prometheus rule format, each naming its runbook in `docs/runbooks/`          |
| `alerts/tests/`         | `promtool` unit tests for the rules                                                         |
| `dashboards/*.json`     | One dashboard per area (requests, jobs, security events), in Grafana's dashboard JSON model |

## What is measured

The API and worker send OTLP metrics (`apps/api/src/telemetry/`). Every label
comes from a closed list: route template, method, status code, app, module,
queue, error code, rate limit and second factor. No tenant, user, record,
email address, IP address or free text is ever a label, and nothing here adds
one.

| Signal                          | Metric, as Prometheus names it                        |
| ------------------------------- | ----------------------------------------------------- |
| Response time and request count | `http_server_request_duration_seconds` (histogram)    |
| Failed requests                 | `tps_http_server_errors_total`, by `tps_problem_type` |
| Job failures                    | `tps_job_failures_total`, by queue and error code     |
| Jobs waiting                    | `tps_queue_depth`, by queue                           |
| Dead-lettered jobs              | `tps_queue_dead_letters`, by queue                    |
| Rate-limit refusals             | `tps_rate_limit_hits_total`, by limit                 |
| Second-factor failures          | `tps_mfa_failures_total`, by factor                   |
| Oldest pending auth audit copy  | `tps_auth_audit_copy_oldest_pending_seconds`          |

Sign-in failures are the sign-in routes' `unauthenticated` responses in
`tps_http_server_errors_total`.

## Loading them into your own backend

Keep the Collector and the metrics backend in the cell's jurisdiction
([ADR 0012](../../docs/adr/0012-hosting-targets-and-cells.md)).

1. Run the OpenTelemetry Collector with `collector/config.yaml`. Set
   `TPS_COLLECTOR_METRICS_ENDPOINT` to your backend's OTLP HTTP address,
   for example `http://prometheus:9090/api/v1/otlp` for Prometheus 3 started
   with `--web.enable-otlp-receiver`.
2. Point the API and worker at the Collector:
   `TPS_OTEL_ENDPOINT=http://<collector host>:4318`.
3. Load `alerts/tps.rules.yaml` as a rule file (Prometheus `rule_files`, or
   any ruler that reads the format) and route the alerts to your operators.
4. Import each file in `dashboards/` into Grafana, or into any tool that
   reads Grafana's dashboard JSON, with your Prometheus as the default data
   source.

A backend that names OTLP metrics differently from Prometheus (with dots
kept, say) needs the metric names in the queries changed to match.

## Checks

Run before every pull request that changes this folder, from each tool's
official image pinned by digest:

```sh
promtool check rules infra/observability/alerts/tps.rules.yaml
promtool test rules infra/observability/alerts/tests/*.yaml
otelcol validate --config=infra/observability/collector/config.yaml
```

The managed service's copy has its own test, which fails if any alert or
dashboard here has no copy there:
`tofu -chdir=infra/terraform/gcp/monitoring test`.

## Changing a threshold

Each threshold sits in its rule with a one-line reason. Change the rule,
its test if it has one, and any dashboard line that shows the same
threshold, in the same pull request.
