# ADR 0020: Release emails without a worker in MVP1

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

[ADR 0009](0009-background-jobs.md) sends release emails as pg-boss jobs:
"releasing decisions and queuing the release emails happen in one
transaction through `fromKysely(trx)`", and a worker sends them. MVP1 is due
at the end of October 2026 and has no other job. Building the pg-boss schema,
its tenant trigger, the per-queue grants, the send helper, the handler
wrapper and a worker container now would add about 400 lines of
security-critical review and a day of work, all for one email per decision.

Constraints: decisions stay private until released, and telling the applicant
is a separate step ([architecture rule 8](../ARCHITECTURE.md)); a release must
not be lost or half-done because the mail server is slow or down; and every
email must be traceable to the release that caused it.

## Options considered

1. **Build pg-boss and the worker now,** as ADR 0009 describes. The intended
   design, at the cost above.
2. **Send inside the release transaction.** A slow or failing mail server
   holds or rolls back the release, and a crash after sending leaves emails
   for a release that never committed.
3. **An outbox table written in the release transaction, sent by the API
   after commit.** The release commits on its own; unsent emails stay
   visible and can be sent again; the worker can take over later without a
   schema change.

## Decision

Option 3, for MVP1.

- The grants module keeps the outbox, `grants.decision_email`, with real
  foreign keys to the decision and to the recipient's `party.person`. Each
  module that sends email keeps its own outbox this way
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)); the platform
  provides only the SMTP sender.
- Releasing writes one row per released decision, with status `pending`, in
  the same transaction that sets `released_at` and writes the release audit
  event.
- After that transaction commits, the API sends the release's pending emails
  in the same request, each in its own short transaction. Before sending, it
  checks that the decision is still released and that its release audit event
  exists, as ADR 0009 requires of the job. It renders the template version
  fixed at release, using only fields released to the recipient
  ([ADR 0004](0004-api-contract.md)), reads the recipient's address through
  the party contract, and marks the row `sent`, or `failed` with an error
  code and no message text.
- A release sends at most 500 emails in its request; any more stay pending.
  Staff see how many emails are unsent for a round and can send them again;
  each resend is audited.
- Delivery is at least once: a crash after the mail server accepts an email,
  but before the row is marked, sends it twice on resend.
- Every column is classified, and rows are kept as long as their decision,
  since they record who was told what, and when.
- Sign-up and sign-in emails are not affected: the auth module sends them
  during the request, and a person who misses one asks again.

After MVP1, when pg-boss arrives with reminders, the release transaction also
sends a job and the worker sends the pending rows; the in-request sending is
removed. The outbox stays as the record of what was sent.

## Consequences

- MVP1 needs no worker container, and ADR 0009's guarded exception is not
  yet in use.
- The release request takes longer, in proportion to its emails, which is
  acceptable at MVP1's volumes.
- This ADR amends ADR 0009's sentence on release emails until the worker
  arrives.

## Dependency check

No dependency is added. The SMTP client is chosen with the auth emails, under
[ADR 0002](0002-licence-and-dependency-policy.md)'s dependency rules.
