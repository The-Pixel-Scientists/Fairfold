# Find and read records

Use this guide to find an organisation or a person and read everything CRM
shows about them. You need the right "Search and view contacts and their
timelines", and CRM must be switched on for your funder. If it is off, or you
lack the right, the pages answer "not found".

## Find a record

1. Choose **Records** in the CRM section. The page is titled "Organisations
   and people".
2. In **Search**, enter a name, an email address or a charity or company
   number. Enter at least 2 characters.
3. Optionally choose a **Kind** (organisations or people), a **Status**
   (Active, Archived, Merged, Erased or any) and an **Identifier** (Any,
   Verified, Unverified or No identifier).
4. Choose **Search records**.

The page says how many results it found, such as "12 results" or "50 or more
results". Choose **Show more results** to read on. A search reads at most 1,000
results. If you reach that, narrow your search.

Each row shows the name (a link), the kind, the status and, for an
organisation, whether its identifier is verified. A person shows a dash in the
identifier column.

Search starts with active records. A merged record's result points to the
record it became. An erased person shows as "Erased person".

### Your search stays private

The words you type are sent with the request and nowhere else. They are never
put in the address, the page title, the browser history, local storage, the
audit log or the server log. A search cannot be shared as a link.

If you open a record and go back, the page remembers your results and your place
in the list, in memory only. A new search or a reload clears them.

## Read an organisation

Choose a name to open it. The page shows:

- **Details**: legal form, registered address and website.
- **Identifiers**: the register, the number and whether it is **Verified** or
  **Unverified**. See [Verify an identifier](verification.md).
- **Contacts**: the people who are a current contact for the organisation, with
  their email addresses. Choose a name to open the person.
- **Lists**: the lists the organisation is on, if any.
- **Value history**: how its details have changed, newest first, with the time,
  the detail, the value before and after, and "A member of staff" or "The
  system". Choose **Show more changes** to read on. Only members who may edit
  records see this section.
- **Timeline**: what has happened with the record, newest first.

An archived organisation shows an "Archived" tag.

## Read a person

A person's page shows **Details** (email address and phone number), **Contact
for** (the organisations they are a contact for), **Lists**, **Value history**
and **Timeline**.

An erased person's page says "This person's details have been erased, so only
their status is kept."

## Read a timeline

The timeline lists each item with when it happened, what happened, which tool it
came from and any details. Notes, calls, meetings and emails that staff record
appear here. So do two things CRM learns from Grants while CRM is on:

- Application submitted
- Decision released

A decision appears only after it is released. A decision that is not released
never reaches the timeline. Where you may open the application, the item has an
**Open the application** link. The timeline holds a reference, not a copy.

Choose **Show more of the timeline** to read on.

## Follow a merged record

If you open the address of a record that was merged, CRM takes you to the record
it became and says "This record was merged".

## Edit a record

The console has no screen for editing a record yet. The shared record's API
lets a member with the right "Edit organisations and people, verify identifiers
and record relationships":

- change an organisation's details (name, legal form, address and website);
- change a person's name and phone number;
- add an identifier, which starts as unverified, or remove one;
- add a person to an organisation (see [Relationships](relationships.md)).

Every change writes an audit event naming the member and the fields that
changed, never their values. It also adds a row to the record's value history.

## What is recorded when you read

These reads are recorded as sensitive reads: opening an organisation or a
person, opening a timeline, a search page or a page of possible duplicates that
holds a person, a merge preview, and a page of import rows. The audit event
holds ids only: no name, email address, search term or cell.

An organisation's page is recorded as well as a person's, because it shows its
contacts' names and email addresses.
