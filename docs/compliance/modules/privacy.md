# Data protection

Data protection is for subject access requests, breaches, impact assessments
and records of processing, built on how every tool classifies its data. The
module itself is not yet available. See the
[module README](../../../modules/privacy/README.md).

On 19 November 2026 the module has a manifest and empty server, console and
portal folders. Its classification file is empty: it has no tables and holds
no personal data.

## What exists today instead

The platform already provides parts of this work:

- A records of processing generator reads the classification map:
  `packages/db/src/records-of-processing.ts`. The
  [DPIA template](../dpia-template.md) quotes it.
- Subject access and erasure run across modules from the map:
  [Retention and subject access](../../admin/retention-and-subject-access.md).
- The [incident runbook](../../runbooks/incident.md) has the 72-hour route to
  the Information Commissioner's Office.

## Personal data it holds

None yet.

## Row-level security and audit

Not yet available. Any new table needs a policy and a cross-tenant denial
test before it merges.

## Open items

- A breach log, a request tracker and an impact assessment workspace: not yet
  available.
