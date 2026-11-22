# Lists and segments

Use lists and segments to group organisations and people. A list is a set you
keep by hand. A segment is a saved filter that works out its members each time
you open it.

You need the right "Search and view contacts and their timelines" to read
lists and segments. You need "Manage lists" to change lists and "Manage
segments" to save segments. CRM must be switched on for your funder.

## A list is not consent to contact

Putting a record on a list or in a segment does not give anyone permission to
contact it. CRM sends nothing from a list or a segment. The screens say so:
"Nothing is sent to a list."

Any tool that sends messages to a list or a segment must check each person's
consent and suppression before it sends. It does that through the shared
record, one person at a time, and it skips people who may not be contacted
(ADR 0033, consent and communications). For an organisation on a list, it
reads the organisation's current contacts. You provide your own lawful basis
for contacting people.

## Create a list

1. Choose **Lists** in the CRM section.
2. Choose **Create list**.
3. Enter a **Name**. Add a **Description** if you want to.
4. Choose **Create list**.

The page shows each list with its name, its number of members and a status of
"In use" or "Archived". A list name and description must not name a person.

To change a name, choose **Rename list** on its row. The screen renames only;
it does not change a description.

## Add records to a list

1. Open a list from the **Lists** page. The page is titled "List members".
2. Under **Add records to this list**, enter a name, an email address or a
   charity or company number in **Search**, then choose **Search records**.
3. Tick the records you want. Only active records are offered.
4. Choose **Add 3 to list**, where the number is how many you ticked.

The page says how many it added, and how many were already on the list, such as
"Added 2 to the list, 1 already on it." Adding the same record again changes
nothing. You can add up to 500 records at a time.

A list holds only organisations and people that are active or archived. A
merged or erased record cannot be added.

## Remove a record from a list

Choose **Remove from list** on the member's row. This removes the record from
the list only. It does not change the record. Each add and remove is audited
with your name and the record's id.

## Archive a list

1. On the **Lists** page, choose **Archive list** on the row.
2. Choose **Archive list** in the dialog.

The members are kept. The list moves to the end of the lists and its status
becomes "Archived". An archived list cannot be changed. The server answers
"This list is archived. Restore it by creating a new list." There is no
restore button, so make a new list if you need one.

## Save a segment

1. Choose **Segments** in the CRM section.
2. Under **Build a segment**, enter a **Name**. Add a **Description** if you
   want to.
3. Under "Records match when all of these are true", choose a **Field**, a
   **Comparison** and a **Value** for the first filter.
4. Choose **Add filter** for each further filter. A segment holds between 1 and
   10 filters. A record is a member only if every filter matches.
5. Choose **Save segment**.

The fields you can filter on are:

| Field | Comparisons | Value |
| --- | --- | --- |
| Kind | is | Organisation or Person |
| Status | is, is not | Active, Archived, Merged or Erased |
| Legal form | is, is not | A legal form from the shared list |
| Identifier register | has, does not have, has verified | A register, such as a charity or company register |
| List | is, is not | One of your lists |
| Interaction | has, does not have | Note, call, meeting or email |
| Last interaction | is before, is after | A date |
| Created | is before, is after | A date |

The list is closed on purpose. No filter reads a name, an email address or any
other personal detail, so a segment cannot be used to pick people by who they
are. The API also knows a "Contact for" field, which the screen does not offer
because it needs an organisation's id.

### What a segment shows

Open a segment from the **Segments** page. It shows its filters in words, such
as "Kind is Organisation", and the records that match now. The members are
worked out each time you open the page, so they stay current. Only the id and
kind of each member are held by CRM; names are read from the shared record.

A segment shows only records your funder holds and that you may read. Another
funder's records are never visible. Opening a segment that lists people writes
a sensitive-read audit event for each person shown.

You cannot edit or archive a segment on screen today. The API can: a change
creates a new version, and an archived segment cannot be changed ("This segment
is archived. Create a new segment to use its filters again."). To change a
segment on screen, save a new one.

### Segments are versioned configuration

A segment is configuration, so every change is recorded. Each save writes a
configuration version with the author and a record of what changed, and an
audit event "crm.segment.saved". The version number on the page rises by one
with each change.

The record of a change lists which filters changed by their field and
comparison. It never holds a filter's value, so it shows that a filter changed
but not what it now matches. Archiving a segment writes the audit event
"crm.segment.archived" and no configuration version.

If two people change the same segment at once, the second save is refused with
"This segment was changed by someone else. Reload it and try again."

## Errors you may see

| Message | What to do |
| --- | --- |
| Enter a name for the list. | Type a name. |
| Enter a name for the segment. | Type a name. |
| Add between 1 and 10 filters. | Keep at least one filter and no more than ten. |
| Choose a field to filter on from the list. | Pick a field from the menu. |
| Choose a comparison that works with this field. | Pick a comparison the field allows. |
| Choose or enter a value that fits this field, such as a date like 2026-11-16. | Pick a value, or enter the date as year, month, day. |
| Add up to 500 records at a time. Choose fewer records, then add them. | Tick fewer records. |

## Rules restated

- **Tenant isolation.** Lists, segments and their members belong to your
  funder. The database enforces this on every CRM table.
- **Audit.** Creating, renaming and archiving lists, adding and removing
  members, and saving or archiving segments write audit events with the acting
  member. Events hold ids and counts only, never a name or a filter value.
- **Versioned configuration.** Segment changes keep their author and history.
- **No contact without consent.** A list or a segment is not a basis for
  sending anything.
- **Retention.** List and segment rows are kept for as long as your funder
  holds its data with the platform. A list member is only a record id. Erasing a
  person leaves their id on the lists it was on, and nothing about them but
  that id.
