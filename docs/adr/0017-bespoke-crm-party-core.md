# ADR 0017: Bespoke CRM, starting with the party core

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

[ADR 0008](0008-standalone-or-twenty.md) chose to build standalone for V1,
left the organisation and contact layer to Phase 2, and kept Twenty open as
the CRM. On 2 October 2026 Aaron decided the suite will have its own CRM, and
that its party core (organisations, people, the relationships between them,
and consent) arrives in MVP1 as a small shared module: the master record for
organisations and people in every module
([ADR 0016](0016-modular-suite-and-shared-warehouse.md)). Grants needs it
first, for applicant organisations and contacts; DCA partners and finance
payees come next.

Constraints:

- Row-level security, composite foreign keys, classification, and audit
  events without personal values ([ADR 0003](0003-query-builder-and-migrations.md)).
- An organisation record belongs to one tenant. Sharing across funders is the
  Phase 4 applicant passport, with its own DPIA.
- 360Giving identifies recipients by org-id.guide identifiers (ADR 0008).
- Typing an organisation's identifier must never give an applicant access to
  that organisation's record.
- Erasure (E3) must be possible without breaking other modules' references.

## Options considered

1. **Applicant organisation tables inside grants,** as ADR 0008 planned.
   Quick, but every later module would copy them or reach into grants.
2. **Twenty.** Rejected in ADR 0008 for its own auth, tenancy and data model,
   Redis, and commercially licensed SSO. Nothing has changed.
3. **Separate organisation and person tables with a link table.** Simple, but
   anything that can point at either (a relationship, consent, later a payee
   or partner) needs two nullable columns for each reference.
4. **A `party` supertype that organisations and people extend.** One key for
   anyone the funder deals with, so relationships, consent, payees and
   partners each have one real foreign key.

## Decision

Option 4, as the `party` module (schema `party`, code in `modules/party/`).

### Tables

Every table is a tenant table under ADR 0003, with a uuid id and created and
updated times and actors.

| Table | Holds |
| --- | --- |
| `party.party` | `kind` (`organisation` or `person`) and `status` (`active` or `archived`; erasure adds `erased`). The key other modules reference. |
| `party.organisation` | One row per organisation party: name, legal form (a checked list), structured registered address, website. |
| `party.organisation_identifier` | Scheme (an org-id.guide code such as `GB-CHC`, `GB-COH`, `GB-SC` or `GB-NIC`, from a checked list), identifier, and who verified it and when. |
| `party.person` | One row per person party: given and family names, email, phone, and `user_id`, the account that is this person, if any. |
| `party.relationship` | A typed link between two parties, with optional start and end dates. MVP1 uses `contact_for` (a person for an organisation); further types join the checked list when needed. |
| `party.consent` | One row per consent change: the person, a purpose from a checked list, a channel (`email`, `sms`, `phone` or `post`, since electronic marketing consent is given per channel), `given` or `withdrawn`, the privacy notice version shown, the source and the time. Append-only: the app roles have `INSERT` and `SELECT` only, and the current state is the latest row for each purpose and channel. |

- An organisation or person row shares its party's id. A composite foreign key
  to `party.party (tenant_id, id, kind)`, with the kind fixed by a check,
  keeps each row on a party of the right kind. Relationships carry the kind
  at each end in the same way, and a check ties each relationship type to the
  kinds it joins.
- `person.user_id` is unique within a tenant and is set only from the signed-in
  session. One account is at most one person in each tenant.
- Identifiers are unique within a tenant only among verified rows. An
  identifier an applicant types is a claim, so two records may claim the same
  charity number until staff verify one and merge them. This replaces ADR
  0008's uniqueness rule, which would let one applicant block another, or tell
  them the charity was already known to the funder.

### How grants uses it

- On an applicant's first visit to a tenant's portal, the party module finds
  or creates their person from the session's account, never from the request
  body.
- An applicant creates and edits organisations through the party module's
  contract, which records them as a `contact_for` the organisation. They see
  and change only their own person record and organisations they are a
  current contact for ([ADR 0004](0004-api-contract.md) scope rules). Staff
  need a party permission, and see their own tenant's records.
- Entering an identifier never links anyone to an existing organisation.
  Adding a person to an existing organisation is a deliberate, audited action
  by staff, which arrives with the CRM screens after MVP1.
- Grants references `party.organisation` and `party.person` by composite
  foreign key, as ADR 0016 allows for published keys. It keeps no copy of
  names, addresses or identifiers; screens, the 360Giving export and the
  warehouse read them through the party contract.
- Party records hold current values. The audit log records which fields
  changed, not their old values, so a history of values comes with the CRM.

### Details as submitted

Staff and auditors need an organisation's details as they were when an
application was submitted, not as they are now. Submitting takes a
snapshot:

- In the submit transaction, grants calls the party module's server
  contract, which writes one `party.organisation_snapshot` row (name, legal
  form, registered address, website, and the identifiers with their
  verification state) and returns its id. The application references it by
  composite foreign key, a key party publishes under ADR 0016.
- Snapshots are append-only (`INSERT` and `SELECT` only), classified like
  the columns they copy, kept as long as the application that references
  them, and anonymised on erasure in the same way as the organisation.
- A snapshot is evidence of what was submitted, not a working copy: screens
  that show current details still read the organisation, so grants keeps no
  copy of its own. The full history of values still comes with the CRM.
- It lands before Gate 1, not in MVP1. MVP1 data is synthetic, so nothing
  is lost, and adding it then is one party table, one server function and a
  nullable column on the application, set at submission. MVP1's review time
  goes to the grant loop instead.

Note, 4 October 2026: this snapshot settles the need for a record of party
details as submitted, one of the items due before Gate 1, so no separate
ADR is written for it. The history of values this ADR leaves to the CRM is
decided in [ADR 0025](0025-party-matching-merge-and-search.md): a
party-owned, append-only `party.value_history` table that `crm` reads and
never writes. This note changes no decision here.

### Classification, audit and erasure

- Personal: person names, email, phone and account link; every consent row;
  and an organisation's registered address, which for a small group is often
  someone's home.
- Internal: organisation name, legal form, website and identifiers, and each
  party's kind and status. A tenant may publish some of these for awarded
  grants through 360Giving; that is the export's choice, not a change of
  class.
- No special category data. Each column's retention rule is set in the
  classification map by the migration that adds it.
- Every create, change, link, verification and consent change writes an audit
  event holding ids, codes and field ids.
- Erasure anonymises a person in place: personal columns are cleared and the
  status becomes `erased`. A party is never deleted while another module
  refers to it, since cross-module foreign keys are `ON DELETE RESTRICT`.

### The full CRM

Interactions, pipelines and communications come after MVP1 as the `crm`
module, which tenants switch on (ADR 0016). It references party keys and
never changes party tables. Party stays a separate, always-on module because
every other module depends on it. A connector to another CRM, Twenty
included, still maps ids through an external reference table, as ADR 0008
planned.

## Consequences

- Grants, DCA and finance share one record per organisation and per person,
  and the warehouse joins every module through them.
- Duplicate organisations can exist until verification and merging arrive;
  staff see an applicant's identifiers as unverified.
- The party contracts land before any applicant profile or organisation
  screen.
- Until submission snapshots land before Gate 1, staff see an
  organisation's current details only.
- ADR 0008 is partly superseded: its CRM stance and identifier uniqueness
  rule give way to this ADR. Its rules on separate tables, composite foreign
  keys, org-id.guide identifiers, structured addresses, no CRM-specific
  columns and an external reference table for connectors still hold.

## Dependency check

No dependency is added.
