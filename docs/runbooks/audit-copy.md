# Replay missing audit copies

Use this page when sign-in and account events have not reached a funder's
audit log. The platform records each sign-in or account event in its own
auth audit table, then copies it to the audit log of the funder the person
belongs to. If the copy fails, the event waits as a pending copy. This
command writes the waiting copies.

## When to use this

- The `AuthAuditCopyPending` alert fires: the oldest pending copy is more than
  10 minutes old. It is critical. It names this page.
- The `AuthAuditCopyAgeUnreported` alert fires: the age has not been reported
  for 15 minutes. Check that the API is running and can reach the telemetry
  collector. If it is, run the replay anyway.
- A funder asks why a sign-in is missing from its audit log.

## Before you start

- You are a platform operator on a machine inside the cell's network.
- The command reads the API's settings from the environment, including the
  database settings and the password for the `app_auth` role, and connects as
  `app_auth` and `app_api`. It does not use a superuser or a role that skips
  row-level security.
- You choose no tenant, person or event. The tenant for each copy comes from
  the auth event itself. The command has two options only: `--limit` and
  `--dry-run`.
- There is no `pnpm` script for it yet. Run it with node, with the API's
  settings in the environment:

  ```sh
  node apps/api/src/auth/audit-copy/replay-command.ts --dry-run
  ```

## Steps

1. **Run a dry run first.**

   ```sh
   node apps/api/src/auth/audit-copy/replay-command.ts --dry-run
   ```

   It prints "Dry run: nothing was written." and two counts: pending copies
   due to be written or found already written, and pending copies due to be
   cleared with no copy. It writes nothing.
2. **Run the replay.** The batch limit is 500 by default and 5,000 at most.
   Use a lower limit if the database is under load.

   ```sh
   node apps/api/src/auth/audit-copy/replay-command.ts --limit 500
   ```

3. **Read the counts.** It prints how many auth events it copied, how many it
   found already copied and how many it cleared with no copy due. It prints
   counts only, never ids or addresses. If more are pending than the limit,
   run it again until the counts reach zero.
4. **Read the exit status.** Exit code 0 means every event in the batch is
   done. Exit code 1 means some failed and stay pending: the command prints
   how many, split into constraint, connection and other failures. Exit code
   2 means a bad option or a missing setting, and nothing was written.
5. **Run it again if some failed.** Running it again is safe: each copy is
   keyed by the auth event, so it cannot be written twice.

## Check it worked

- The Security events dashboard's "Oldest pending auth audit copy" falls to 0.
- The `AuthAuditCopyPending` alert clears.
- Each replay writes an "audit copy replayed" event in the auth audit table,
  with a copy in the audit log of the funder, naming the operator.
- A funder's administrator can find the missing sign-in under **Audit log**.

## If something goes wrong

- The command exits with 1 again and again with the same counts: the cause is
  not temporary. Constraint failures suggest a data problem. Connection
  failures suggest the database. Do not edit the database. Start
  [Respond to a security incident](incident.md) at severity 2, and give the
  counts and times.
- The command exits with 2 and prints a setting problem: fix the setting it
  names. It never prints a secret.
- The alert for the missing age stays on: the API cannot report the gauge.
  Check the API logs for the code `audit_copy_age_unread`.
- A pending copy is cleared with no copy: this is correct for events that have
  no funder, such as a failed sign-in by an unknown identifier. They stay in
  the auth audit table.

## Record

Write: the date and time, the alert, the age of the oldest copy before you
began, each run's counts and exit code, and the age after. Never write event
ids, addresses or identifiers.

Each replay writes its own audit event. Events in the auth audit table are
kept for 12 months and cannot be edited.
