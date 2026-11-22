# Deactivate an account

Use this page when a person must stop using the platform altogether, for
example a compromised account or a leaver with roles at several funders.

## When to use this

Choose the smallest action that works.

| Situation | Who acts | Action |
| --- | --- | --- |
| A person leaves one funder's team | The funder's administrator | Remove the membership. See [Team and roles](../admin/team-and-roles.md). |
| A person must stop for now at one funder | The funder's administrator | Suspend the membership. |
| An account is compromised, or must stop everywhere | A platform operator | Deactivate the account (this page). |

Suspending or removing a membership signs the person out of that funder's
sessions at once. A funder's administrator cannot deactivate an account and
cannot change anyone's password or authenticator app.

## Before you start

- You are a platform operator, acting on a request from a funder's
  administrator or the incident lead. Keep the request in your record.
- You have checked who is asking, as in
  [Help a locked-out person](lockout.md), step 6.
- You know which account it is. Identify it from the funder and the ticket,
  and do not copy an email address into a record.

## Steps

1. **Contain first.** If the account may be compromised, ask each funder's
   administrator to suspend the membership now. It takes effect within
   seconds. Then follow [Respond to a security incident](incident.md).
2. **Deactivate the account.** No operator command is available yet. The
   command that deactivates an account across the platform is not on `main`.
   Until it is, rely on step 1 for each funder the person belongs to, record
   the request and pass it to the engineering lead. Do not edit the `auth`
   tables and do not turn the account off by hand.

Once the command exists, it will end every session in the console and the
portal, end every remembered device and email the account holder. The address
will be typed at a prompt, never given on the command line. This page will
then give its exact name.

## Check it worked

- The person cannot sign in, and an old session no longer works.
- Each funder's audit log shows "Membership suspended" or "Membership
  removed" for the memberships you changed. The auth events show "sessions
  revoked".
- [The audit copy](audit-copy.md) has nothing pending, so the funders' logs
  are complete.

## If something goes wrong

- The person is still signed in: check that every funder they belong to has
  suspended the membership.
- Someone asks you to reactivate an account: there is no command for it, and
  you must not change the database. Raise it with the engineering lead, who
  decides.
- The screen refuses to suspend the last active administrator: the funder
  invites or promotes another administrator first.

## Record

Write: the date, the funder or funders, who asked and how you checked, the
action taken, the time sessions ended and the check results. Use ticket
numbers, not email addresses or user ids.

Every membership change and session revocation writes an audit event.
