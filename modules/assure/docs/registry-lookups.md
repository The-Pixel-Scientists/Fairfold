# Registry lookups

A registry lookup copies what a public register says about an organisation, so
you can read it beside the application. It never decides anything.

## Which registers are covered

| Register           | Covers                              |
| ------------------ | ----------------------------------- |
| Charity Commission | Charities in England and Wales      |
| Companies House    | Companies in the UK                 |
| OSCR               | Charities in Scotland               |
| CCNI               | Charities in Northern Ireland       |

In this release, lookups work for the Charity Commission and Companies House.
OSCR and CCNI are not available yet.

A register also needs a key before it works. Where a register has no key, the
panel says "This register is not set up for your funder. Ask an administrator
to add its key." Whoever runs your servers adds keys. See the
[self-hosting quickstart](../../../docs/self-hosting/quickstart.md).

A lookup uses a number the organisation record already holds, such as a charity
number. You cannot type a number into a lookup.

## Read an organisation's registry details

You need "View registry lookups and officers".

1. Open the organisation's registry details. The **Registry details** panel
   shows one section for each register that applies.
2. Read the line under the register's name, for example "From the Charity
   Commission register. Fetched 3 December 2026 at 14:05."
3. Read the details.

The details are:

- **Registered name**
- **Number**
- **Status**: Registered, Removed, Active, Dissolved, In liquidation or Other
- **Registered on**, and **Removed on** where it applies
- **Registered address**
- **Latest accounts**: the year ending, with income and spending where the
  register gives them
- **Accounts overdue**: for companies only

Where a register has no entry for the number, the panel says so. Check the
number on the organisation record, then refresh.

## See officers and trustees

Choose **Show** followed by the number of officers and trustees. The panel
lists each name with a role: Trustee, Director, Secretary, Person with
significant control or Other role. It shows names and roles only.

Officers' and trustees' names are personal data. Opening the list is recorded
in the audit log, so open it only when you need it. A registered address can
also be a home, so it is classed as personal data too.

## How fresh the details are

The panel shows a dated copy, not a live view. Each register section says where
the copy came from and when it was fetched.

- A copy more than 30 days old shows an **Out of date** tag.
- A scan looks up again any copy older than 30 days. It starts at most 50
  lookups each time it runs, so a big backlog takes more than one scan.
- If a register cannot be reached, nothing is stored and the last good copy
  stays.

## Refresh registry details

You need "Refresh registry lookups".

1. In the register's section, choose **Refresh registry details**.
2. The panel says "Refresh started" and checks for the new copy. This can take
   a minute.
3. When the copy arrives, the panel says the register's details are up to date.
   If it has not arrived after about 30 seconds, the panel says to check again
   in a few minutes.

## What a lookup never does

- It never links an applicant to an organisation.
- It never marks an identifier as verified. Verification is a separate action
  by staff in the organisation record.
- It never changes the organisation record.
- It never approves, rejects or scores an application.

A lookup is for staff only. Applicants are never told whether a register knows
their number.

## How long copies are kept

The software registers a retention rule for each field. Registry copies are
kept for 6 years from the day they were fetched. Officers' names are kept for
12 months from the lookup. The software does not yet delete data when its time
passes. Read
[Retention and subject access](../../../docs/admin/retention-and-subject-access.md)
before you write your own policy.

## Where it is recorded

Refreshing a lookup and opening officers write audit events. They hold the
register and the outcome, never a name. See the
[audit log guide](../../../docs/admin/audit-log.md).
