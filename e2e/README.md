# End-to-end journey and isolation tests

These specs run in the `journey` Playwright project, against `pnpm stack`.
Everything in them is synthetic.

## The demo journey

`journey/01` to `journey/16` are the sixteen steps of the demo, one spec file for
each step: the seed, the administrator, the look, the modules, the programme,
the form, the applicant, the application, triage, reviewers, scoring, decisions,
release, data out, the audit log and the second funder. `16b` is step 16 at the
API: every console and portal route contract, called with the first funder's ids
by someone who must not reach them. `17` is the edges a round meets: file
limits, saving over each other, a withdrawn application, and the deadline with
each late policy, which waits two to three minutes for a round to close.

The steps share state, so they run in order, on one worker, on a stack that has
only had the `base` seed:

```
pnpm stack down --volumes && pnpm stack && pnpm stack seed base
TPS_E2E_DEMO=1 pnpm test:stack --project journey --workers 1
```

Without `TPS_E2E_DEMO=1` the journey specs skip themselves, because the other
specs in the stack run need other seeds. A stack that was used once cannot run
the journey again: step 1 says so. The journey sends about 15 sign-up and reset
emails, and the API allows 20 an hour from one address, so a new spec that makes
accounts should reuse one.

## What is where

- `support/` has what the steps share: the stack's addresses, the state file,
  authenticator codes worked out from the key on the screen, Mailpit, a signed-in
  API session, signed-in pages that keep their session, and the audit log reader.
- `fixtures/files.ts` makes the synthetic files in memory: a small PDF, a small
  spreadsheet, a file of a given size and the antivirus test string, which is
  built at run time and never written to disk.
- `isolation/` holds the route cases and the walk that `journey/16b` runs, and
  `database.spec.ts`, which fails when a tenant table has no cross-tenant
  denial test. It reads files only and runs without the journey.

A test marked with `test.fail` is a bug found by the journey and not yet fixed
(the audit log page that holds a stylesheet change, and the API's OpenAPI
document). It fails the day the bug is fixed, and the mark comes off then.

A new console or portal route fails `16b` until `isolation/cases.ts` has a case
for it: a request that names the first funder's records, or a reason it cannot.
