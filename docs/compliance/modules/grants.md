# Grants

Grants runs a funding round: programmes, rounds, forms, stages, assessment,
private decisions, release and export. Read what it does in the
[grants guides](../../../modules/grants/docs/README.md).

## Personal data it holds

From the records of processing, checked on 19 November 2026: 28 `grants`
tables, of which 3 can hold special category data, 2 personal data and the
rest internal. The special category tables are:

| Table group | Data | Proposed condition |
| --- | --- | --- |
| Applications | Answers, which can include health or other special category answers, classified field by field | Explicit consent |
| Adjustments | Reasonable adjustments an applicant asks for | Substantial public interest |
| Monitoring responses | Optional equality monitoring answers, stored apart from the application | Explicit consent |

Confirm each condition in your own DPIA. Other data: applicant contacts,
reviewer assignments, scores, conflict declarations, decisions and their
emails, and application files.

## Controls beyond the platform baseline

- Decisions are private until released. Recording an outcome and notifying
  the applicant are separate operations, and no code path rejects, awards or
  pays without a named user action:
  [Releasing decisions](../../admin/releasing-decisions.md).
- Answers are keyed by stable field ids, and an application pins the form
  version it was submitted against.
- Each answer is classified from its form version, so export, subject access
  and erasure treat special category answers differently:
  `packages/db/test/grants/answer-classification.test.ts`.
- Equality monitoring follows
  [ADR 0032](../../adr/0032-equality-and-monitoring-data.md): separate
  storage, no access for assessors, counts only. That ADR is still proposed.
  Check the code you run against it.
- Reviewers declare conflicts of interest.
- The 360Giving export carries no applicant text.

## Row-level security and audit

- Each table has a policy and a cross-tenant denial test in
  `packages/db/test/grants/`.
- State changes, decisions and releases write audit events:
  `modules/grants/src/server/audit.ts`, tested in `audit.test.ts` beside it.
- Erasure and subject access reach grants data:
  `modules/grants/src/server/erasure.ts`.

## Open items

- 360Giving recipient identifiers are the ones applicants typed. Staff
  verification of them is not yet available.
- A published review of the equality data rules is not yet available.
- Larger exports run inside the request and are capped. A job-based export is
  not yet available.
