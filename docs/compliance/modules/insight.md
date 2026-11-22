# Reporting

Reporting is for trustee and regulator reports from the shared data
warehouse. It is not yet available. See the
[module README](../../../modules/insight/README.md).

On 19 November 2026 the module has a manifest and empty server, console and
portal folders. Its classification file is empty: it has no tables and holds
no personal data.

## What exists today instead

The platform can write a snapshot of its data for the warehouse. See
[Warehouse snapshot](../../self-hosting/warehouse-snapshot.md). The rules
that apply:

- The snapshot holds no personal data.
- Equality monitoring answers never go to the warehouse
  ([ADR 0032](../../adr/0032-equality-and-monitoring-data.md), still
  proposed).
- The choice of reporting tool is in
  [ADR 0039](../../adr/0039-bi-tool-for-insight.md), still proposed.

## Personal data it holds

None yet.

## Row-level security and audit

Not yet available. Any new table needs a policy and a cross-tenant denial
test before it merges.

## Open items

- Reports, funder dashboards and a live warehouse feed: not yet available.
