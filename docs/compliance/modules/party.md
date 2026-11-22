# Party

Party holds the shared record of organisations and people. Other tools point
at it. Read what the module does in
[what the party module does today](../../../modules/party/docs/what-it-does.md).

## Personal data it holds

From the records of processing, checked on 19 November 2026: 8 `party`
tables, 5 holding personal data and 3 internal.

- People: a name and a phone number, started from the person's account.
- Organisations: a name, legal form, website and registered address, with
  registry identifiers.
- Relationships between people and organisations.
- Consent: what a person agrees to hear about, for one purpose at a time,
  with the history of changes.
- A copy of an organisation's details taken at submission time, kept with the
  application it belongs to.

The proposed lawful bases are legal obligation and legitimate interests.
Confirm them in your own DPIA. The module holds no special category columns.

## Controls beyond the platform baseline

- Every party table has a path to the person or organisation it describes,
  so subject access and erasure reach it:
  `modules/party/src/server/subject-data.ts`,
  `modules/party/src/server/erasure.ts`.
- Merging two records is a named action, and the history is kept:
  `modules/party/src/server/merge.ts`.
- Changes to values keep a history table.

## Row-level security and audit

- Each table has a policy and a cross-tenant denial test:
  `packages/db/test/party/`.
- Party actions write audit events: `modules/party/src/server/audit.ts`,
  tested in `audit.test.ts` beside it.

## Open items

- No external review of the module is available yet.
- Staff screens for browsing the shared record: check the module guide for
  what exists. Anything it does not list is not yet available.
