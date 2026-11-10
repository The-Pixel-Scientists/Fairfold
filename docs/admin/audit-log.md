# Audit log

The audit log is a record of who did what, and when, in your funder's account.
Choose **Audit log** in the main navigation. You need the **Administrator**
role. Anyone else sees "You cannot read the audit log".

## What is recorded

The software writes an event when:

- something changes, such as a programme, a setting or a module switch;
- a decision is recorded or released;
- permissions change, such as an invitation, a new role, a suspension or a
  removal;
- something sensitive is read or downloaded, such as a file, a person's record
  or an export.

Each event shows when it happened, what the action was, what it was about, who
did it, and how many fields changed. The actor is a team member, an applicant,
the system, or the operator.

Actions have plain names, for example "Decision released", "Membership roles
changed", "Module switched on", "Publisher setting changed" and "Warehouse
exported".

## Nobody can change or delete entries

The audit log can only be added to. The software cannot edit or delete an
entry, and neither can an administrator. The one exception is built into the
database: it may remove events that are past their retention date. Nothing
runs that yet. See
[Retention and subject access](retention-and-subject-access.md).

## Read an event

Choose a row, or press Enter on it, to open its details. **What changed**
lists each field with its old and new value, where the software kept them.
Some values are not kept, and the details say "Not recorded". The log
shows the names of team members only, never an applicant's.

## Find an event

Above the table, **Filter the audit log** offers:

| Filter | What it does |
| --- | --- |
| **Module** | Only events from one module |
| **Action** | Only one kind of action. The choices depend on the module |
| **Entity type** | Only events about one kind of thing, such as a decision |
| **Entity ID** | Only events about one record. Enter the whole ID |
| **Person** | Only events caused by one team member |
| **From** and **To** | Only events between two dates |

1. Choose your filters.
2. Choose **Apply filters**.
3. Choose **Clear filters** to start again.

Every filter narrows the log, so an event must match all of them. The filters
are in the page address, so you can bookmark a search or send it to a
colleague who is also an administrator.

The table shows 100 events at a time, newest first. Choose **Load more
events** for older ones.

## Reading the log is not recorded

Looking at the audit log does not write an event. The actions above do.

## Not yet available

- Search by person's name or by text: not yet available. Use the **Person**
  filter.
- Export of the log to a file: not yet available.
