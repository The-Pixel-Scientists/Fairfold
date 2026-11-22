# Relationships

A relationship joins one record to another. Use this guide to add a person to
an organisation and to end the link when it stops being true.

## The relationship type

There is one type today.

| Type | From | To | Meaning |
| --- | --- | --- | --- |
| Contact for | A person | An organisation | The person speaks for the organisation |

The kinds are fixed. A person can only be a contact for an organisation. Any
other pairing is refused: "Choose a relationship that fits these two records,
like a person as the contact for an organisation."

A relationship can have a start date. It has an end date once it has ended.

## What a relationship controls

A person who is a **current** contact for an organisation can act for it in the
applicant portal. They can read and change its details there.

- "Current" means the relationship has no end date.
- The portal checks this against the live relationships, so a change takes
  effect on the next request. Nothing is cached in the person's session.
- The person who creates an organisation in the portal becomes its contact.

## Add a person to an organisation

The console has no screen for this yet. The route is "Add a person to an
organisation, such as its contact". It needs the right "Edit organisations and
people, verify identifiers and record relationships".

1. Open the organisation and check the person's record exists.
2. Call the route with the person's id, the type `contact_for` and, if you
   want, a start date such as `2026-11-12`.
3. Open the organisation. The person appears under **Contacts**.

Adding a person who is already a current contact changes nothing. The route
answers the relationship that exists. A merged or erased record cannot be
changed: "This record has been merged into another or erased, so it can't be
changed. Open the record it was merged into."

## End a relationship

The route is "End a relationship on a date; it is kept, never deleted".

1. Call the route with the relationship's id and an end date such as
   `2026-12-01`.
2. The person disappears from **Contacts**. The relationship stays in the
   record's history.

Three things to know:

- The end date must be the same as or after the start date: "Enter an end date
  that is the same as or after the start date."
- A relationship that has ended cannot be ended again: "This relationship has
  already ended."
- **Any end date ends the person's access at once.** Even a date in the future
  counts as ended now. Do not set a future date to schedule the end.

## What is recorded

Adding a relationship writes the audit event `party.relationship.created`.
Ending one writes `party.relationship.ended`. Each names the member. Relationships
are never deleted.

## Relationships and merging

A merge changes relationships as follows. The full rules are in
[Duplicates and merging](duplicates-and-merging.md#what-a-merge-does).

- Merging two organisations ends every current contact link on the organisation
  you merge away. They are not carried to the one you keep, because each would
  gain access to the other organisation's records. Add the people again by hand
  if they should be contacts.
- Merging two people ends the links of the person you merge away. They are
  carried to the person you keep only when neither person has an account.
