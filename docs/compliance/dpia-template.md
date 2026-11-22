# DPIA template for a self-hosted deployment

Use this template to write the data protection impact assessment (DPIA) for
your own deployment. A DPIA is yours. The project cannot write it for you,
because the risks depend on who your applicants are, what you ask them and
where you host. This template gives you the software's side: what personal
data it holds, why, for how long and how a person's rights are met.

Fields to complete are marked **[Complete]**. Delete this paragraph and the
guidance notes when you publish. Nothing here is legal advice. Ask your data
protection officer or solicitor to confirm every lawful basis.

## 1. About this assessment

| Field | Entry |
| --- | --- |
| Organisation (the controller) | **[Complete]** |
| Deployment name and address | **[Complete]** |
| Version of the software | **[Complete]** (record the release tag) |
| Tools switched on | **[Complete]** (the platform and party records are always present; every other tool is off until an administrator switches it on) |
| Assessor and date | **[Complete]** |
| Data protection officer's advice | **[Complete]** |
| Next review date | **[Complete]** |

## 2. Why a DPIA is needed

**[Complete]** Say why you are doing one. Reasons often include: you hold
information about people applying for money, you may hold special category
data (equality monitoring answers, health information in an application),
and you make decisions that affect people.

## 3. What the processing is

**Nature.** The software runs a funding round: programme set-up, an
applicant portal, eligibility, assessment, private decisions, release and
data export. Optional tools add records of organisations and people,
due diligence, and more.

**Scope.** **[Complete]** Number of applicants a year, regions, how long you
keep data.

**Context.** **[Complete]** Who the applicants are, whether any are
children or vulnerable, and what they expect.

**Purpose.** **[Complete]**

## 4. Data flows

The table below comes from the software's records of processing, built from
the field classification map in `packages/db/src/records-of-processing.ts`.
It covers 108 tables, of which 59 link to a person or organisation. Run the
generator against the release you deploy before you publish, because a later
release may add tables.

"Highest sensitivity" is the most sensitive value any column in those tables
can hold. "Processor roles" are the kinds of service involved. You name them
in section 6.

| Purpose | Highest sensitivity | Who the data is about | Proposed lawful bases | Processor roles |
| --- | --- | --- | --- | --- |
| Account security (sign-in, sessions, authenticator apps) | Personal | Applicants, reviewers, staff, visitors | Contract; legitimate interests | Hosting, backup, email |
| Tenant administration (members, invitations, settings) | Personal | Applicants, reviewers, staff | Contract; legitimate interests | Hosting, backup, email |
| Party records (organisations, people, relationships, consent) | Personal | Applicants, applicant contacts, reviewers, staff | Legal obligation; legitimate interests | Hosting, backup, email |
| Programme administration (programmes, rounds, forms, stages) | Internal | None directly | Contract | Hosting, backup |
| Grant applications (answers, files, messages, notes, adjustments, monitoring answers) | Special category | Applicants, applicant contacts, reviewers, staff | Consent; contract; legal obligation; legitimate interests | Hosting, backup, email |
| Assessment (scores, assignments, conflicts, eligibility) | Personal | Applicants, reviewers | Contract; legitimate interests | Hosting, backup |
| Decisions (outcomes and decision emails) | Internal | Applicants | Contract | Hosting, backup, email |
| File storage | Personal | Applicants, reviewers, staff | Contract | Hosting, backup, malware scanning |
| Audit (who did what, and when) | Personal | Applicants, applicant contacts, reviewers, staff, visitors | Legitimate interests | Hosting, backup |
| Background jobs | Personal | Applicants, applicant contacts, reviewers, staff | Legitimate interests | Hosting, backup |
| Service reliability (rate limits, repeat-request keys) | Personal | Applicants, reviewers, staff, visitors | Legitimate interests | Hosting, backup |
| Due diligence (checklists, registry lookups) | Personal | Applicants, applicant contacts, organisation officers | Legitimate interests | Hosting, backup |
| Sanctions screening | Personal | Applicants, applicant contacts, listed persons, organisation officers | Legal obligation | Hosting, backup |
| Grant monitoring (visits, outcomes and results) | Personal | Applicants, applicant contacts | Legitimate interests | Hosting, backup |

Notes on the table:

- The lawful bases are proposals in the software's map. Confirm or change
  each one for your organisation. **[Complete]**
- Special category data sits in two places: equality monitoring answers
  (explicit consent) and reasonable adjustments (substantial public
  interest), plus any special category answers on an application form
  published before monitoring answers moved to their own form. The map
  proposes these conditions: explicit consent for application and
  monitoring answers, and substantial public interest for adjustments.
  **[Complete]** Record your Article 9 condition and your appropriate policy
  document.
- Data categories the software holds are identity, contact details, online
  identifiers (for example an IP address held with a session) and other.

### Data you add yourself

**[Complete]** List data you add that the software does not classify: free
text in your own forms, uploaded documents, email templates and notes.

## 5. How long data is kept

The map gives every column a retention rule. In plain English:

| Data | Kept for |
| --- | --- |
| Sessions, device records and sign-in counters | Short, fixed periods: from one day to 366 days. Session network details go with the session, at most 90 days after it ends. |
| Account data | While the account exists. |
| Programme, application, assessment, decision, file and party data | While your account exists, unless your retention policy or an erasure request ends it sooner. **[Complete]** your policy periods. |
| Audit events | At least 365 days, never below a platform minimum that no funder can lower. Rows past their date are removed by one named function, which writes its own audit event. |
| Background job records | Seven days after the job completes. |
| Due diligence lookups and screening records | Between 90 days and six years, depending on the record. |
| Backups | **[Complete]** Your backup schedule. The recommended design keeps daily copies for 35 days. |

Retention is yours to set within the platform's limits. See
[Retention and subject access](../admin/retention-and-subject-access.md).

## 6. Who else sees the data

List every processor and sub-processor you use. The software's map names
only the roles.

| Role | Provider | Country | Contract in place | Notes |
| --- | --- | --- | --- | --- |
| Hosting (compute and database) | **[Complete]** | **[Complete]** | **[Complete]** | |
| File storage | **[Complete]** | **[Complete]** | **[Complete]** | |
| Backup | **[Complete]** | **[Complete]** | **[Complete]** | |
| Email sending | **[Complete]** | **[Complete]** | **[Complete]** | |
| Malware scanning | Runs as a container beside the API, so usually your own host | **[Complete]** | **[Complete]** | |
| Sign-in provider, if you use single sign-on | **[Complete]** | **[Complete]** | **[Complete]** | |
| Other | **[Complete]** | **[Complete]** | **[Complete]** | |

International transfers: **[Complete]**.

## 7. How people's rights are met

| Right | What the software does | What you do |
| --- | --- | --- |
| Be informed | Nothing. | Publish a privacy notice. **[Complete]** |
| Access | The subject access function finds a person's data through the classification map and exports it. Equality monitoring answers are in a separate output. | Verify the requester and send the export within one month. |
| Correction | Staff correct records, and history is kept. | Decide who may correct what. |
| Erasure | Erasure runs across modules from the map. Audit events keep ids and codes only, never personal values. | Decide each request, and tell people that copies in backups expire on schedule. |
| Restriction and objection | A dedicated restriction control is not yet available. | Handle by process. **[Complete]** |
| Portability | Exports are available to administrators. | Decide what you provide. |
| Automated decisions | None. No code path may reject, award or pay without a named user action. | State this in your notice. |

Subject paths in the map: 24 tables link to a person by a direct party id, 19
by a join, 8 by an account and 3 to several people. Five are marked
unlinked. See [Retention and subject access](../admin/retention-and-subject-access.md).

## 8. Equality and monitoring data

The software's rules for equality data are in
[ADR 0032](../adr/0032-equality-and-monitoring-data.md). Check them against
the release you run, because the ADR is still proposed:

- Monitoring questions are optional, each has "Prefer not to say", and there
  are no free-text questions.
- Answers are stored apart from the application. Nobody who assesses or
  decides applications can see whether an applicant answered.
- Staff see counts only. A suppression rule hides small groups so no one can
  be singled out.
- Answers never go to the data warehouse.

**[Complete]** Say how you will use the counts and who may read them. See
[Equality monitoring](../../modules/grants/docs/equality-monitoring.md).

## 9. Risks

For each risk, rate the likelihood and the severity, record your controls
and the risk that remains. The third column suggests the software's controls
to cite. **[Complete]** the ratings and your own measures.

| Risk | Software controls to cite | Your measures and rating |
| --- | --- | --- |
| One funder sees another's data | Row-level security on every tenant table and a cross-tenant denial test for each: [control mapping](control-mapping.md) | **[Complete]** |
| Someone signs in who should not | Required MFA for staff, rate limits, session timeouts | **[Complete]** |
| An applicant learns a decision early | Decisions are private until a separate release step | **[Complete]** |
| Special category data is seen by the wrong person | Separate storage and access rules for monitoring answers; adjustments visible only where needed | **[Complete]** |
| Personal data stays too long | Retention rules and the purge function | **[Complete]** |
| An upload carries malware | ClamAV scan before storage | **[Complete]** |
| Data is lost | Encrypted nightly snapshots and a restore runbook | **[Complete]** (record your restore test) |
| Data leaves through logs or exports | Logs hold ids and codes; exports need permissions and are audited | **[Complete]** |
| A breach is not reported in time | The [incident runbook](../runbooks/incident.md) with the 72-hour route | **[Complete]** |
| Staff misuse records | Audit log of reads of sensitive records | **[Complete]** |

## 10. Sign-off

| Item | Entry |
| --- | --- |
| Measures approved by | **[Complete]** |
| Residual risks approved by | **[Complete]** |
| Data protection officer's advice, and whether you followed it | **[Complete]** |
| Consulted the ICO? | **[Complete]** (needed if a high residual risk remains) |
| Review trigger and date | **[Complete]** |
