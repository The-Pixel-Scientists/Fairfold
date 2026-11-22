# CRM

CRM is where staff find, tidy and organise the organisations and people your
funder works with. It reads the shared record of organisations and people that
every tool uses. It never keeps its own copy of a name, email address or
identifier.

This page says what CRM does today and links to a guide for each job. It
describes what is built. Where something has no screen yet, the guide says so.

## Who it is for

- **Programme managers** use every screen: search, duplicates, merging, lists,
  segments and imports.
- **Administrators** switch CRM on and off. They also hold the right "Export
  contacts". These guides do not cover exports.
- **Reviewers** have no CRM rights.

The rights are named in the access catalogue and grouped into roles. A
programme manager holds all of the rights below.

| Right | What it allows |
| --- | --- |
| Search and view contacts and their timelines | Search, open records, read lists and segments |
| Record interactions and external references | Add a note, call, meeting or email to a timeline (API only) |
| Review and dismiss possible duplicates | Open "Possible duplicates" and mark pairs as not duplicates |
| Merge duplicate organisations and people | Compare and merge records (asks you to confirm it is you) |
| Manage lists | Create, rename and archive lists, and change their members |
| Manage segments | Save and change segments |
| Import organisations and people | Check and confirm a CSV import (asks you to confirm it is you) |

Editing a record, verifying an identifier and recording a relationship belong
to the shared record, not to CRM. They need the right "Edit organisations and
people, verify identifiers and record relationships".

## Switch it on

No tool is on until an administrator switches it on. Follow
[Modules](../../../docs/admin/modules.md) and switch on **CRM**.

While CRM is off:

- its screens are hidden from the navigation;
- its pages answer "not found", and its screens make no request;
- its data stays, and it returns when CRM is switched on again.

A timeline only collects applications and decisions while CRM is on. Switching
CRM on does not backfill earlier ones.

## What you can do

| Job | Guide |
| --- | --- |
| Find a record and read its page | [Find and read records](people-and-organisations.md) |
| Mark an identifier as checked | [Verify an identifier](verification.md) |
| Link a person to an organisation | [Relationships](relationships.md) |
| Compare and merge two records | [Duplicates and merging](duplicates-and-merging.md) |
| Group records | [Lists and segments](lists-and-segments.md) |
| Bring in records from a spreadsheet | [Import from a CSV file](csv-import.md) |
| Join CRM data to your own reports | [Warehouse data contract](warehouse-data-contract.md) |

## What has a screen and what does not

| Job | Screen | API route |
| --- | --- | --- |
| Search, open an organisation or a person, read the timeline and value history | Yes | Yes |
| Possible duplicates, compare, mark as not duplicates, merge | Yes | Yes |
| Lists and segments: create, rename, archive, members | Yes (a segment is saved, not edited, on screen) | Yes |
| Check an import's rows and confirm it | Yes | Yes |
| Start an import (upload a file and map its columns) | No | Yes |
| Edit a record, add or remove an identifier, verify an identifier | No | Yes |
| Add a person to an organisation, end a relationship | No | Yes |
| Record a note, call, meeting or email | No | Yes |
| Undo a merge | No | Defined, not built |
| Links to other systems (Twenty, Salesforce) | No | Defined, not built |

## Rules that always apply

- **Tenant isolation.** You only ever see your own funder's records. The
  database enforces this on every CRM table.
- **Humans decide.** Nothing merges, links, verifies or imports by itself. A
  named member of staff takes each of those actions.
- **Everything that matters is audited.** Merges, imports, list and segment
  changes, and edits write an audit event naming the member. Searching, opening
  a record or a timeline, and reading import rows are recorded as sensitive
  reads.
- **Nothing is sent from CRM.** Lists and segments organise records. They are
  not consent to contact anyone.
- **Retention.** CRM keeps a record's rows for as long as the record. Import
  rows and jobs are kept for shorter, set periods. See
  [Import from a CSV file](csv-import.md#how-long-import-rows-are-kept).

## What you still provide

CRM provides the controls above. Your organisation provides its own lawful
basis for holding and contacting people, its privacy notice, and the choice of
who holds which role.
