# ADR 0031: Registry lookups and sanctions data

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

The `assure` module's first release (wave 1, March 2027) checks applicant
organisations against the UK charity and company registers and screens
organisations and people against the UK sanctions list. Both must exist
before the first live payment. [V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1)
keeps them out of V1; they arrive with `assure` as a module under
[ADR 0016](0016-modular-suite-and-shared-warehouse.md), in schema `assure`.

Constraints:

- Every data source's licence must be checked against
  [ADR 0002](0002-licence-and-dependency-policy.md), which denies
  non-commercial licences.
- Every outbound request follows
  [ADR 0010](0010-authentication-security-rules.md#outbound-requests): one
  global dispatcher, and pinned clients only for fixed destinations.
- An identifier on a party is a claim. Verification is a named party action,
  and typing an identifier never links anyone to an existing record
  ([ADR 0017](0017-bespoke-crm-party-core.md); ADR 0025, proposed, extends
  this to names and postcodes).
- Registers publish trustees' and directors' names, which are personal data.
- Rule 9 and UK GDPR Article 22: a sanctions match is a suggestion, and a
  person decides.
- Criminal offence data (UK GDPR Article 10) needs a legal condition that a
  self-hosted product cannot assume for every funder.
- One cell per jurisdiction: each deployment fetches its own data, and a
  self-hoster needs no account with us.

Facts about each source below rest on general knowledge where marked (GK).

## Options considered

Sanctions data:

1. **The UK government's published list.** Free, under the Open Government
   Licence, and the list that UK financial sanctions law refers to. Covers UK
   designations only.
2. **OpenSanctions.** Wider coverage (UN, EU, US lists, and politically
   exposed persons), but its data is licensed for non-commercial use, with a
   paid licence otherwise (GK). The managed service is commercial and ADR
   0002 denies non-commercial licences.
3. **A commercial screening vendor** (Dow Jones, LexisNexis,
   ComplyAdvantage). Paid per tenant and closed, so a self-hoster could not
   run the same product.

Where the sanctions list lives:

4. **One platform table, outside row-level security.** The list is public
   and the same for every tenant. Needs a named exception to rule 2.
5. **A copy per tenant under RLS.** No exception, but every download fans
   out to every tenant, the list is stored once per tenant (about 20,000
   name rows per version, GK), and two tenants could screen against
   different versions of the same list.

API keys:

6. **One key per deployment**, held by the operator. One secret per source,
   read like every other secret.
7. **A key per tenant**, stored encrypted in the database. Each tenant
   registers with each register, and we need key storage and re-encryption
   like SSO secrets ([ADR 0010](0010-authentication-security-rules.md)).

## Decision

Options 1, 4 and 6.

### Sources

| Source                                   | Scheme   | Access                                                                                                                                                                                                                                                                                  | Rate limits                                                                  | Terms                                                                                    |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Charity Commission for England and Wales | `GB-CHC` | Register of Charities API at `api.charitycommission.gov.uk/register/api/`, JSON over HTTPS, one charity per request (details, trustees). Key from its API portal, sent in the `Ocp-Apim-Subscription-Key` header (GK)                                                                   | No published figure (GK). We send at most 5 requests a second per deployment | API terms of use; register data under the Open Government Licence v3.0 (GK)              |
| Companies House                          | `GB-COH` | Public Data API at `api.company-information.service.gov.uk`, JSON over HTTPS (company profile, officers, persons with significant control). Key sent as the HTTP Basic user name (GK)                                                                                                   | 600 requests in 5 minutes per key (GK). We send at most 500                  | API terms of use; data free to reuse, and personal data in it must be used lawfully (GK) |
| OSCR (Scottish Charity Regulator)        | `GB-SC`  | Daily download of the whole Scottish Charity Register as CSV from the OSCR website (GK). OSCR also offers an API with a key (GK); wave 1 uses the download, so no key is needed                                                                                                         | One download a day                                                           | Open Government Licence v3.0 (GK)                                                        |
| Charity Commission for Northern Ireland  | `GB-NIC` | Download of the register of charities as CSV from the CCNI website; no public API (GK)                                                                                                                                                                                                  | One download a day                                                           | Open Government Licence v3.0 (GK)                                                        |
| UK Sanctions List (FCDO)                 | none     | Download of the whole list in a machine-readable format from GOV.UK. Since 28 January 2026 it is the single UK list, and OFSI's Consolidated List of Asset Freeze Targets has closed (GK). S12-26 confirms the address and format, preferring one we can parse without a new dependency | One download a day                                                           | Open Government Licence v3.0, with its attribution statement                             |

Any of these can be unavailable in a deployment: a source with no key, or a
download that has never succeeded, shows in the console as "Not set up" or
"Not available", and nothing else changes.

### Keys

- One key per source per deployment (option 6), held by the operator: the
  managed service holds one set per cell, and a self-hoster registers for
  their own free keys.
- Keys are read at start-up with `readSecret` from
  `TPS_CHARITY_COMMISSION_API_KEY` and
  `TPS_COMPANIES_HOUSE_API_KEY`, or the matching `_FILE` variables.
  A missing key leaves that source "Not set up"; it never stops start-up.
- A key is sent only in its header, only to its source's configured host.
  It never appears in a URL, a log line, an audit value, a job payload, a
  span attribute or an error.
- The worker shares each source's rate limit fairly between tenants, so one
  tenant's batch cannot use a cell's whole allowance.
- Option 7 waits for a register's terms to require it. Before S12-17 builds
  the adapters, we confirm that each register's terms let one key serve
  lookups for many funders.

### Outbound requests

- Registry API calls go through the global dispatcher with all its rules:
  HTTPS only, checked addresses, at most 3 redirects, a 1 MB body, and
  connect and response time limits. The client refuses any redirect that
  leaves the source's configured host, so a key never follows one.
- Downloads (the sanctions list and the OSCR and CCNI registers) are larger
  than 1 MB, so each uses a client pinned to its configured download host,
  as ADR 0010 allows for fixed destinations. A pinned client keeps every
  dispatcher rule except the body size: the same address checks at connect
  time, HTTPS with certificate verification, at most 3 redirects, each a new
  checked connection and only to the configured hosts, and the same connect
  limit. Its body cap is 64 MB and its whole download has 5 minutes; raising
  either needs an amendment to this ADR.
- Every response is parsed strictly: a Zod schema per response or row, with
  types, lengths and code lists checked. A download with any row that fails
  the schema is refused whole, never loaded in part.
- Nothing from a response is rendered as HTML or followed as a link. Values
  are shown as text, and links to a register's own page are built from our
  template and the identifier, never taken from a response.
- No raw response, and no downloaded file, is kept, in the database or as a
  file under ADR 0030 (proposed).

### Lookups

A lookup copies the fields we use, from one source for one identifier, into
the tenant's `assure.lookup_snapshot`:

| Column                                           | Holds                                                                                                                                                  | Class                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `organisation_id`                                | The organisation whose identifier was looked up: a composite foreign key to `party.organisation`, a published key                                      | internal                                                              |
| `scheme`, `identifier`                           | The identifier as looked up                                                                                                                            | internal                                                              |
| `source`                                         | A checked list: `charity_commission`, `companies_house`, `oscr`, `ccni`                                                                                | internal                                                              |
| `fetched_at`, `outcome`                          | When, and `found` or `not_found`                                                                                                                       | internal                                                              |
| `list_id`                                        | For OSCR and CCNI, the register download the row was copied from: a foreign key to `assure.reference_list`, `ON DELETE RESTRICT`; null for API sources | internal                                                              |
| `registry_status`                                | A checked list mapped from each source: `registered`, `removed`, `active`, `dissolved`, `in_liquidation`, `other`                                      | internal                                                              |
| `registered_name`, `registered_on`, `removed_on` | Name, and registration or incorporation and removal or dissolution dates                                                                               | internal                                                              |
| `registered_address`                             | Structured, as in `party.organisation`                                                                                                                 | personal, as ADR 0017 classifies an organisation's registered address |
| `financial_year_end`, `income`, `expenditure`    | Charities' latest reported year; money as integer minor units and a currency code (ADR 0016)                                                           | internal                                                              |
| `company_type`, `accounts_overdue`               | Companies only                                                                                                                                         | internal                                                              |

Officers, charity trustees and persons with significant control go in
`assure.lookup_officer`, one row per person: snapshot id, name, a role code,
appointed and ceased dates, and `person_id`, a nullable composite foreign
key to `party.person`. The name and dates are personal. We do not store
dates of birth, nationalities, addresses or anything else the registers
publish about these people.

`person_id` is the officer row's subject path (ADR 0027, proposed). Only a
named staff action sets it: a member with `assure.lookup.link` links the
row to a person after checking it is them, and the link is audited
(`assure.officer.linked`, with the subject party id). No lookup, refresh,
screening run or name comparison sets or suggests it (ADR 0017; ADR 0025,
proposed). A row with no link is unlinked under ADR 0027: an officer's name
belongs to someone the tenant may not hold as a party.

- **When.** On demand by staff with `assure.lookup.run`, as a job that acts
  for the user ([ADR 0009](0009-background-jobs.md)); on submission, through
  grants' submission event, for each identifier the organisation claims whose
  newest snapshot is older than 30 days; and monthly, through the
  `app.tenant_ids()` fan-out, for organisations with an application in an
  open round or under assessment, and later with a live grant. Payloads hold
  the tenant, organisation and identifier ids only. OSCR and CCNI lookups
  read the latest download (below) rather than calling out.
- **Failure.** A source that cannot be reached fails the job with an error
  code. No snapshot is written, and staff see "Could not reach the register.
  Try again later." with the time of the last good snapshot.
- **Retention.** A snapshot cited by a verification, a checklist answer or a
  screening run is kept under the tenant policy `assure.lookup`, by default
  6 years from `fetched_at` (GK, the usual period for grant records; for the
  solicitor). Other snapshots are deleted 90 days after a newer one replaces
  them. The longer period follows the evidence purpose, not the link, so an
  officer row does not simply go with its snapshot. Every officer row,
  linked or not, is deleted 12 months after `fetched_at`, or with its
  snapshot if sooner, unless it has become evidence: a match raised from it
  is decided `confirmed` or `needs_information`, or a verification cites the
  row itself. Only a linked row can become evidence, since both need the
  link first; it is then kept with its snapshot. A verification that cites
  only the snapshot keeps none of its officers. No tenant setting extends
  the 12 months, which also meets ADR 0027's limit for unlinked data.
- **Rights requests.** Subject access and erasure follow `person_id`. When
  someone asks for their data, a member handling the request with
  `assure.lookup.read` can search officer rows by name, a sensitive read
  audited with the result ids, never the term, and links the rows that are
  the requester (above), creating the person first if the tenant does not
  hold them (ADR 0017). Subject access then includes those rows and
  the matches raised from them, and erasure clears their names. Nothing is
  matched or cleared by name alone, so a namesake is never touched. A link
  made for a request changes no retention: the rows keep the 12-month limit
  unless they later become evidence as above, so asking to see one's data
  never extends how long it is kept.
- **A person created for a request.** It holds only the name the requester
  gave and the contact details needed to reply, and nothing else uses it.
  Whether it may be kept after the request as the record that the request
  was answered, or must be erased once it is, goes to the solicitor
  (S11-03). Until that advice, no build relies on keeping it.
- **Refresh after erasure.** A later refresh of the organisation collects
  its current officers again, as a new, unlinked row, because screening the
  people who control an organisation the tenant funds is needed to avoid
  making funds available to a designated person. The erasure covers the data
  held at the time; the new row has the 12-month limit above and is covered
  by the privacy notice (below). The basis for collecting the name again
  (legal obligation under UK GDPR Article 17(3)(b), or legitimate interests
  the person can object to) goes to the solicitor (S11-03). Refresh stops
  when the organisation has no application in an open round or under
  assessment and no live grant.

### No self-linking

- A lookup never links an applicant to an existing party, never marks an
  identifier verified, and never changes a party record. Verification stays
  a named party action by staff (ADR 0017); the verification's audit event
  cites the snapshot id the person relied on.
- Lookups run for staff and from jobs, never from a portal request, and
  nothing about a lookup or its result is shown in the portal. An applicant
  is never told whether their identifier matches a register entry or another
  record. The later `lookup-widget` needs its own decision.
- Duplicate candidates found through identifiers stay under ADR 0025's rules
  (proposed): shown to staff only, advisory.

### Reference lists

The sanctions list and the OSCR and CCNI register downloads are public,
identical for every tenant, and held once per deployment (option 4) in
three platform tables in schema `assure`, owned by the module:

- `assure.reference_list`: one row per loaded file: source
  (`uk_sanctions_list`, `oscr_register`, `ccni_register`), the date the file
  says it was published, `downloaded_at`, `last_checked_at`, SHA-256 of the
  file, row count, and `superseded_at`, null while it is the current version
  for its source. These rows hold no personal data and are never deleted:
  they are the deployment's record of which version was current when, and
  screening runs, matches and register snapshots cite them.
- `assure.sanctions_entry`: one row per name or alias of a designation: list
  id, the list's unique id for the designation, entity kind (`individual`,
  `entity`, `ship`), regime code, date designated, the name and its
  normalised form, and, for individuals, dates of birth, nationalities and
  country of address as published. A trigram index (ADR 0025) covers the
  normalised name. We do not store the statement of reasons, "other
  information" or any other free text.
- `assure.register_entry`: one row per charity in a register download: list
  id, scheme, identifier, name, status, registration and removal dates, and
  the latest financial figures. A lookup copies the row into the tenant's
  snapshot.

These three tables are the one exception this ADR makes to rule 2. They have
no `tenant_id` and no RLS. `app_api` and `app_worker` hold `SELECT` only.
They are written only by one approved definer function,
`assure.load_reference_list(source, published_on, sha256, rows)`, owned by
a `NOLOGIN` role of its own ([ADR 0003](0003-query-builder-and-migrations.md),
handed over as [ADR 0023](0023-function-owner-memberships.md) sets out),
with `EXECUTE` for `app_worker` only. It loads the rows in one transaction,
makes them current, sets `superseded_at` on the version they replace, and
deletes the `sanctions_entry` and `register_entry` rows of versions
superseded more than 90 days ago. It never deletes a `reference_list` row. A
Semgrep rule allows calling it only from the download handler. S12-14 adds
the tables, the function and their catalogue-test entry:

| Object                                                                     | Reason                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assure.reference_list`, `assure.sanctions_entry`, `assure.register_entry` | Public reference data published by UK government bodies, the same for every tenant. App roles hold `SELECT` only; only `assure.load_reference_list()` writes |

Each source is downloaded by a scheduled platform job, once a day at 06:00
UK time, and on demand by a platform operator's command. A file whose hash
matches the current version only updates `last_checked_at`. A download is
refused, and the last good version stays current, if it fails, fails to
parse, or has more than 10% fewer rows than the current version; the job
fails with an error code and the operator is alerted through the job
failure metric. Each `assure.reference_list` row is the record of its load,
since a platform job has no tenant audit log.

### Screening

- **Who.** An applicant organisation (its party name and the registered
  name from its newest snapshot), the people who are its current
  `contact_for`, and the officers in its newest snapshot. Individuals are
  compared with `individual` entries, organisations with `entity` entries.
- **When.** On submission, through grants' submission event; on demand by
  staff with `assure.screening.run`; and when a new list version loads,
  against the entries added or changed since the previous version, for
  parties with an application in an open round or under assessment, and
  later with a live grant. The re-screen fans out per tenant through
  `app.tenant_ids()`.
- **How.** Names are normalised as ADR 0025 normalises them (proposed).
  A name raises a match when its normalised form equals an entry's, or when
  their trigram similarity is at least the threshold in the tenant's
  screening settings. The platform default is 0.5; a tenant may lower it to
  catch more, never raise it, and a check constraint holds that ceiling.
  S12-26 tests the default against the list and a synthetic name set, and
  changes it by amending this ADR.
- **Records.** `assure.screening_run` holds the subject party, the trigger
  code, `list_id`, the list's `last_checked_at`, the threshold and settings
  version used, a status and counts. `assure.screening_match` holds the run,
  where the name came from (the party record, or an officer row by its id),
  `subject_party_id`, `list_id`, the designation's unique id, the matched
  name, the entity kind, the regime code and the similarity. Both `list_id`
  columns are foreign keys to `assure.reference_list`, `ON DELETE RESTRICT`,
  so a run always shows the published date and hash of the version it used.
  A match copies what a person deciding it needs as evidence, so the entries
  of superseded versions can be deleted.
- **Whose match.** `subject_party_id` is a nullable composite foreign key to
  `party.party` and the match's subject path. For a name from a party
  record it is that organisation or person. For a name from an officer row
  it is the person the row is linked to, copied when the row is linked by
  the named action above, and null while it has none. The officer row
  reference is `ON DELETE SET NULL`, so a match outlives its row. A match
  raised from an officer row, linked or not, is deleted with its decisions
  12 months after its run unless it is decided `confirmed` or
  `needs_information`. Deciding it so needs the officer linked to a person
  first, so the evidence kept for 6 years always has a subject, and a link
  made only for a rights request keeps nothing longer.
- **A stale or missing list never passes.** If the current list was last
  checked more than 48 hours ago, the run's status is `stale_list`, and with
  no list it is `no_list`. Staff see "Not screened against a current list"
  with the date, never "No matches", and the run is repeated when a good
  version loads.

### Match decisions

- A match is only ever raised for review. A person with
  `assure.screening.decide` decides it, after re-authentication within the
  last 5 minutes (ADR 0010), with an outcome (`not_a_match`,
  `needs_information`, `confirmed`) and a reason code from a checked list
  (for example `different_date_of_birth`, `different_nationality`,
  `different_entity_kind`, `identity_confirmed`). There is no free text.
- `assure.match_decision` is append-only (`INSERT` and `SELECT` only for app
  roles). The latest row is the match's state; the deciding membership comes
  from the session.
- A later run does not raise the same designation for the same subject name
  again once a person has decided it is `not_a_match`, unless the
  designation's entry has changed since, or the match has been deleted after
  its 12 months (above), when it is raised and decided again.
- No code path rejects, holds, blocks or pays on a match (rule 9). Open and
  confirmed matches show on the party and its applications, and later at
  payment approval, to members who may see them (below), where a person
  decides. Reporting a confirmed match to OFSI is the funder's act, outside
  the product; the `assure` guide explains it.
- Applicants are told, in the privacy notice template the portal shows,
  that they, their organisation and its named people are screened against
  the UK sanctions list, that the names of the organisation's officers are
  copied from public registers for this and kept as set out here, that a
  person reviews every possible match, and that nothing is decided
  automatically (UK GDPR Articles 13, 14 and 22). Nothing in the portal
  shows that a match exists.

### Who sees assure data

- Viewing has permissions of its own, apart from running and deciding:
  `assure.lookup.read` for snapshots and their officers, and
  `assure.screening.read` for runs, matches and decisions.
  `assure.lookup.link` links an officer row to a person. Each is checked on
  the server on every request, with a cross-tenant denial test per route.
- No reviewer role bundle holds any `assure` permission. Lookup snapshots,
  officers, screening runs and matches never appear in reviewer or
  blind-reviewer projections ([ADR 0004](0004-api-contract.md)), in
  reviewer notifications, or in a search a reviewer can run. A matched
  designated name, a registered name or an officer could otherwise identify
  an applicant under blind review, and sanctions data stays with the
  people doing due diligence.
- Elsewhere, a member without the read permission sees nothing of a
  snapshot or match, not even that one exists: the party and application
  screens leave the panel out.

### No Article 10 data in core

- Core holds no adverse-media, criminal record or offence data about
  individuals. PEP and adverse-media screening comes only through a later
  plugin, which a tenant licenses itself; so does OpenSanctions (option 2).
- A sanctions designation is a minister's decision under the Sanctions and
  Anti-Money Laundering Act 2018, on reasonable grounds to suspect
  involvement in an activity, not a conviction. Some regimes, such as
  counter-terrorism, concern conduct that is also criminal, so a confirmed
  match on a person could be read as criminal offence data. We therefore keep
  only the published identifying details and never the statement of
  reasons, and a match and its decision hold ids, scores and codes. Whether
  screening is still Article 10 processing, which condition in Schedule 1 to
  the Data Protection Act 2018 would then apply (GK: Part 2 paragraph 10 or
  12, through Part 3 paragraph 36), and whether subject access may withhold
  match records (GK: Schedule 2 paragraph 2) go to the solicitor (S11-03).
  Until that advice, subject access includes match records, marked for the
  funder's review before release.

### Reused bank details

The reused-bank-details check moves out of `assure` wave 1 into wave 2 with
`finance`, decided with payee bank details in ADR 0043 (payee bank details
and payment controls), so S11-37 and S12-35 do not build it.

### Classification, audit and retention

- Reference tables: names, dates of birth and nationalities in
  `assure.sanctions_entry` are personal, though published; every other
  column is public. Entry rows are kept until their version has been
  superseded for 90 days; `assure.reference_list` rows are kept for good.
  They are platform data, so no tenant's warehouse contribution includes
  them (ADR 0016).
- Lookup snapshots and officers: as in the tables above. `person_id` is
  internal; an officer row's subject path is `person_id`, and every officer
  row has the fixed 12 months unless it has become evidence (above).
- Screening runs, matches and decisions: ids, codes, scores and times are
  internal; the matched name is personal. They are kept under the tenant
  policy `assure.screening`, by default 6 years from the run (GK; for the
  solicitor), except officer-row matches not decided `confirmed` or
  `needs_information` (12 months). A run's subject
  path is its subject party; a match's is its `subject_party_id`; a
  decision's is its match.
- Audit events, with ids and codes only: `assure.lookup.completed` (source
  and outcome), `assure.officer.linked`, `assure.screening.completed`
  (status and counts), `assure.match.decided` (outcome and reason code).
  Opening a snapshot's officers or a match is a sensitive read and audited.

## Consequences

- Every fact marked (GK) is confirmed before S12-17 builds the adapters:
  each endpoint, header, rate limit, download address and format, and each
  source's terms, including whether one deployment key may serve many
  funders. The sanctions list's address and format are confirmed before
  S12-26 builds screening. A source whose terms do not fit is left "Not set
  up" until this ADR is amended.
- Rule 2: every new tenant table (`assure.lookup_snapshot`,
  `assure.lookup_officer`, `assure.screening_run`, `assure.screening_match`,
  `assure.match_decision`) has `tenant_id`, RLS and a cross-tenant denial
  test, and so does every read route. The three reference tables are the
  one named exception.
- Rule 3: composite foreign keys to `party.organisation`, `party.person`
  and `party.party`; foreign keys from snapshots, runs and matches to
  `assure.reference_list`, `ON DELETE RESTRICT`; and check constraints for
  every code list above, including the threshold ceiling.
- Rule 4: lookups, officer links, screening runs and match decisions write
  audit events with ids and codes; match decisions are append-only; reads
  of officers and matches are sensitive reads.
- Rule 5: every new column is classified with a retention rule and a subject
  path, including the reference tables.
- Rule 6: the actor, and the person deciding a match, come from the
  session; the server re-validates every input with the shared domain
  package.
- Rule 9: nothing rejects, blocks or pays on a lookup or a match.
- Rule 10: screening settings (`assure.screening_setting`) and due-diligence
  checklists (`assure.checklist`) are versioned configuration.
- The `assure` contracts entry point (S11-37) imports the jitless zod switch
  first, as every contracts entry point does.
- The catalogue test gains one named exception and one approved definer
  function, both added by S12-14.
- Self-hosters register for two free keys to use the England and Wales and
  company registers. The Scottish and Northern Irish registers and the
  sanctions list need no key.
- The console shows the Open Government Licence attribution wherever
  register or sanctions data appears, and the `assure` guide repeats it.
- Screening covers UK designations only. Funders that also need UN, EU or
  US lists, or PEP data, wait for the plugin API.
- Five questions go to the solicitor (S11-03): the Article 10 reading of
  sanctions matches, subject access to match records, the default retention
  periods, the basis for collecting an officer's name again after erasure,
  and whether a person created only to answer a rights request may be kept
  after it.
- Officer rows and their matches go after 12 months unless they have become
  evidence, so an organisation screened only once has no other officer data
  after that. Staff who need to keep a match decide it, which needs the
  officer linked to a person.
- ADR 0027 (proposed) must change to match. Its "Subjects" paragraph passes
  each subject's names to every contribution so that one "matches on them
  where it holds no party id, as ADR 0031's officer rows do". Officer rows
  are reached only through `person_id`, and matching on a name would clear
  or disclose a namesake's rows. That sentence and the reference to this
  ADR are removed from ADR 0027 before either ADR is committed.

## Dependency check

No package is added. Each deployment fetches the data at run time, so the
operator is the licensee; we bundle none of it. Each licence is recorded
against ADR 0002 as if it were a data file:

| Source                      | Licence                                                      | Against ADR 0002                                                                                                      |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Charity Commission register | Open Government Licence v3.0 (GK)                            | Allowed: attribution only, commercial use permitted, compatible with CC BY 4.0, which ADR 0002 allows for data        |
| Companies House public data | Companies House terms, free reuse (GK)                       | Allowed if confirmed: no non-commercial or no-derivatives term (GK)                                                   |
| OSCR register               | Open Government Licence v3.0 (GK)                            | Allowed, as above                                                                                                     |
| CCNI register               | Open Government Licence v3.0 (GK)                            | Allowed, as above                                                                                                     |
| UK Sanctions List           | Open Government Licence v3.0                                 | Allowed, as above. Attribution: "Contains public sector information licensed under the Open Government Licence v3.0." |
| OpenSanctions (not chosen)  | Non-commercial licence, paid licence for commercial use (GK) | Denied as a default (non-commercial). Only as an optional plugin a tenant licenses itself                             |
