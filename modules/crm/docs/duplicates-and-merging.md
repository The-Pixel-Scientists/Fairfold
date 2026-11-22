# Duplicates and merging

Use this guide to find records that may be the same organisation or person,
compare them, and merge them. You need the right "Review and dismiss possible
duplicates" to see candidates. You need "Merge duplicate organisations and
people" to compare and merge.

A merge is the riskiest thing CRM does. A wrong merge can show one applicant's
records to another. Read the whole guide before your first one.

## What a possible duplicate is

A possible duplicate is a suggestion. It says two records look alike and a
person should look. It never changes anything, and nothing is merged,
linked or flagged automatically.

Candidates are worked out when you open the page. They are not stored. Merged
and erased records are never candidates.

### How candidates are found

| The page says | Applies to | What matches |
| --- | --- | --- |
| Same verified number | Organisations | The same register and number, and staff verified it on either record |
| Same number, not verified | Organisations | The same register and number, and nobody verified it |
| Similar name | Organisations | Names that are alike (similarity of 0.6 or more) |
| Similar name and the same postcode | Organisations | Names that are less alike (0.4 or more) and the same postcode |
| Same email address | People | The same email address |
| Similar name at the same organisation | People | Names that are alike (0.6 or more) and a current contact link to the same organisation |

A postcode on its own never makes a candidate. It only counts alongside a
similar name.

Each pair has a strength:

- **Strong match**: same verified number, same email address.
- **Likely match**: same number but not verified, similar name and the same
  postcode, similar name at the same organisation.
- **Possible match**: similar name only.

A pair's strength is that of its strongest reason. The page never shows the
values that matched.

## Open the list

1. Choose **Possible duplicates** in the CRM section.
2. Optionally choose a **Kind** and a **Why they match** reason.
3. Read the pairs. Strongest come first within each page. Choose **Show more**
   at the foot of the table to read on, if it is offered.

Each page reads 25 records and asks for each one's candidates, so a pair
appears once, with the lower id as its first record. If the list says "No
possible duplicates", try another kind or reason, or check back after an
import.

Opening a page that holds people is recorded as a sensitive read.

## Mark a pair as not duplicates

Each row has **Mark as not duplicates**. It asks "Why are they not
duplicates?" with these choices:

- for organisations: "They are different organisations", "They are related but
  stay separate" or "Both records are needed";
- for people: "They are different people", "They are related but stay separate"
  or "Both records are needed".

The dialog says "Nothing is merged or changed. These two records are not
suggested again."

**As built, the button does not work yet.** The screen and the route are in
place, but the server does not record dismissals. A pair you dismiss comes back.

## Compare two records

1. In the list, choose **Compare records** on a pair. CRM asks you to confirm
   it is you if you have not signed in recently ("Confirm it is you to compare
   records"; "Comparing records needs a recent sign-in").
2. Under "Which record do you keep?", choose the record that stays. The other
   one is merged away.
3. Read the table "Fields of the two records". Each row shows a detail, the
   value on the record you keep ("Keep: name"), the value on the other ("Merge
   away: name") and whether they are "Same" or "Different". An empty value
   shows "Empty".
4. Read **Contact links** below it.

Comparing changes nothing. It runs the merge in the database and always undoes
it, so the conflicts and counts shown are exactly what a merge would do now. It
writes a sensitive read for each record, `crm.merge.previewed`.

If the records cannot be merged, a notice titled "These records cannot be
merged yet" lists the reasons. See [When a merge is blocked](#when-a-merge-is-blocked).

## What a merge does

To merge, choose **Review merge of organisations** or **Review merge of
people**. A dialog titled "Merge organisations" or "Merge people" says what will
move, for example "3 applications and 1 list membership will move to Name.
Other name will be marked as merged." Choose **Merge organisations** or
**Merge people** to confirm, or **Cancel**.

The record you keep is the **survivor**. The other is the **loser**.

- **The loser stays.** It is marked Merged and points to the survivor. Nothing
  is deleted. Opening its address takes you to the survivor.
- **What points to the loser moves to the survivor.** This covers every tool,
  including tools that are switched off, in one step. CRM moves list
  memberships, timeline items and links to other systems. Grants is designed to
  move applications and decision emails, but its move is not registered yet
  (see [When a merge is blocked](#when-a-merge-is-blocked)). The dialog counts
  what will move. A list the survivor is already on keeps only the survivor's
  membership. A timeline item the survivor already has stays on the loser.
- **Identifiers.** For organisations, a number only the loser holds is added to
  the survivor, with its verification. The same type with a different value
  stays on the loser as an unverified claim.
- **Contact links.** Contact links on the loser end. For two organisations,
  none are carried over. For two people, they are carried over only when
  neither has an account. A link the survivor already has is not added twice.
- **Evidence stays as it was.** These keep the ids they were written with and
  are never re-pointed: the organisation details an application was submitted
  with, consent records, value history, earlier merge records and audit events.
  A submission's snapshot keeps the loser's details.
- **Nothing is sent or decided.** A merge does not change an application's
  status, outcome or amount, and resends nothing.

### Who can see what afterwards

Whatever moved is now part of the survivor's record. A current contact of the
survivor can reach it, and a contact of the loser no longer can, because the
loser's contact links ended. Check the two records' contacts before you merge,
and add anyone who should keep access to the survivor by hand (see
[Relationships](relationships.md)).

### The check before it happens

Comparing and merging both ask you to confirm it is you if your last sign-in
is not recent.

Confirming a merge needs a token from the comparison you just read. The server
rebuilds the comparison and refuses a token that:

- does not match what the records are now;
- was made by another member or for another funder;
- is more than 5 minutes old.

You then see "The records changed after you compared them. Compare the records
again, then merge." Compare again, read it, and merge.

### What is recorded

- A merge record: the two ids, the kind, how many rows moved in each table, who
  decided and when. It is append-only. No route changes or removes one.
- The audit event `crm.merge.confirmed`, with the merge record as its entity.
  Counts are written as table and number only.
- The audit event `party.party.merged`.

No audit event, error or log holds a name, email address or field value.

The page then says "The records are merged" with the merge record's id and a
link, "the record you kept".

### When a merge is blocked

The server refuses a merge for these reasons. Clear the cause, then compare
again.

| The page says | What to do |
| --- | --- |
| Choose two different records to merge. | Pick two records, not one |
| Choose two organisations or two people to merge. | Do not mix kinds |
| One record is already merged. Merge with the record it was merged into. | Open the record it became and use that |
| One record has been erased. Choose records that have not been erased. | An erased record cannot be merged |
| Choose an active record to keep. | An archived record cannot be the survivor |
| Both people have accounts, so keep both records until one of the accounts is closed. | Close one account first |
| Keep the record of the person who has an account: swap which record you keep. | Choose the person with the account as the survivor |
| Both organisations have different verified numbers of the same type, so keep them as separate records. | They are different organisations |
| Correct the number on the record you keep, or swap which record you keep. | Only the loser's number is verified; swap the records or correct the survivor |
| Another tool could not move its records. Check its records, then try again. | A tool refused. For example, Grants refuses when both organisations have a live application in the same round |
| Another tool is not ready to move its records. Contact support. | A tool holding records about a party has no move registered. The merge is refused for every pair until it is |
| Some records changed since the merge. Move them back by hand, then try again. | Used for an undo, which is not built |

A verification also blocks a merge when the member who verified it is no longer
an active member of staff.

## Can a merge be undone

**No, not today.** The design allows an undo from the merge record. The route
exists and has no handler, there is no screen, and CRM's own move refuses a
restore. A merge cannot be reversed through the product.

Treat every merge as final. Compare carefully. Take a backup first if you are
unsure, and ask your operator how to restore.

## Known gaps in the screen

- Under **Contact links**, an organisation merge says "No contact links move,
  because the record you keep has an account." The reason is wrong for
  organisations, which have no account. Their links end and are not carried.
- The screen has a "choose which links to carry over" step. The server never
  offers it, and refuses a confirm that lists links to carry. People's
  links move automatically or not at all.

## Rules restated

- **Humans decide.** No job, timer or event starts a merge. Only a named member
  confirming a comparison does.
- **Tenant isolation.** Both records must be in your funder. Another funder's
  record answers "not found".
- **Audit.** Every comparison and merge is recorded.
