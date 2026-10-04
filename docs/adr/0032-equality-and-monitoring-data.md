# ADR 0032: Equality and monitoring data

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

Funders want to know whether their funding reaches people and communities
fairly: who applies, who gets through each stage and who is awarded. That
needs equality monitoring answers, such as ethnicity, disability, religion
or sexual orientation, from applicants or about the people who lead an
applicant organisation. Most of these are special category data under UK
GDPR Article 9. For a small organisation, "led by" answers identify the
people who lead it.

The form engine already has an `aggregate_only` audience: the applicant sees
their own answer, staff and reviewers never do, and `canSee()` keeps it out
of every projection ([ADR 0004](0004-api-contract.md)). Nothing yet says
where such answers are stored, under which consent, whom they may be about,
how they are counted, or how a count is kept from identifying someone.

Constraints:

- Special category data never enters the warehouse
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)).
- Subject access and erasure must still reach the answers (ADR 0027,
  proposed).
- A person's consent covers data about them, not about anyone else.
- Applicant pools are small and local, and reports pair answers with
  outcomes, so a count of three can tell a reader who was turned down.
- A single filter, such as one round or one region, can make any group
  small. Reports over nested or neighbouring filters can be subtracted from
  each other, and so can two runs of one report made before and after the
  data changed.
- Funders differ in their legal footing, and the product must serve all of
  them without a setting that weakens protection.

## Options considered

Where answers live:

1. **In the application's answers, as S05-01 built.** Nothing new, but every
   export, projection, search and log must remember to drop them, and one
   miss exposes them next to the applicant's name.
2. **A separate table that only one folder of grants' server code reads.**
   The answers sit apart from the application, with no view, foreign key or
   route that reaches them from anywhere else.
3. **A separate table that app roles cannot read, reached only through
   approved definer functions.** The strongest boundary, but every report
   shape becomes a reviewed SQL function, and disclosure control moves into
   SQL, away from the one engine every module's aggregates should share.

Whom questions are about:

4. **Only the person answering.** Their own explicit consent covers their
   answers, and subject access and erasure reach them through their person
   record.
5. **Also the people who lead the applicant organisation** ("led by"
   questions). Funders ask for these, but for a small organisation they
   identify its trustees, who have not consented, are not told, and have no
   route to their data.

Disclosure control:

6. **A suppression threshold alone.** Simple, and defeated by filters and by
   subtracting one report from another.
7. **A threshold, secondary suppression within and across linked tables, a
   minimum group, fixed filters, closed rounds only, and a log of report
   runs** that refuses a run which, with earlier runs, would reveal a small
   group.
8. **Rounding or random noise** (differential privacy). Sound in theory, but
   small funders find perturbed figures hard to explain to trustees, and it
   still needs rules for filters.

## Decision

Options 2, 4 and 7. Option 3 is the fallback if review finds the boundary in
option 2 too weak; option 8 can be added later on top of option 7.

### Where answers live

- Monitoring answers are stored in `grants.monitoring_response` (S12-09), a
  tenant table owned by grants, apart from application answers. One row per
  application: the round, the application (a composite foreign key), the
  monitoring form version it was answered against (rule 7), the respondent
  person (`party.person`, from the session), the answers keyed by stable
  field id, the region code copied from the submitted application, the
  consent record (below) and `submitted_at`.
- No view, foreign key, search index or other table points at it. Only
  `modules/grants/src/server/monitoring/` queries it, and a Semgrep rule
  bans its table name and generated type everywhere else. That folder
  exposes exactly four things: the applicant's own response, the separate
  subject access output and the erasure contribution (ADR 0027, below), and
  counts for the disclosure engine (below). Apart from the subject access
  output under `grants.monitoring.disclose`, no staff, reviewer or export
  route, and no warehouse contribution, calls any of them.
- The monitoring form is per round and wholly `aggregate_only`: S11-54's
  definition rules refuse any other audience in a monitoring form. Each
  field is a choice from a fixed list with "Prefer not to say", none is
  required, and there are no free-text fields, since free text cannot be
  counted and often identifies its writer.
- The portal offers the form after the application is submitted, as its own
  step. Skipping it loses nothing, and nobody who assesses or decides
  applications can see whether an applicant answered. Staff submitting on
  an applicant's behalf can neither see nor fill it in; the applicant is
  invited to answer it themselves.
- A round closes for monitoring at the later of its deadline and its last
  per-application extension. After that no response is added to the round
  and none is changed; the applicant can still see and withdraw theirs.
  Before it, nothing is counted (below), so a change shows in no report.
- `aggregate_only` fields in application forms published before this ADR
  stay where they are. They are never projected to staff or reviewers
  (`canSee()`), never counted in reports, classified special category field
  by field (ADR 0027), and reached by subject access and erasure. Published
  versions are immutable and MVP1's forms hold synthetic data only, so
  nothing is moved. From S11-54, application forms may no longer use
  `aggregate_only`; monitoring questions go only in monitoring forms.
- Reasonable adjustments are not monitoring: staff must see them to act on
  them, so they stay in the application under their own rules.

### Whom questions are about

- Decided: monitoring questions ask only about the person answering (option
  4). S11-54 holds a platform question set in `packages/domain`, each
  question worded about the person answering ("your ethnic group"), with
  its options and "Prefer not to say". A monitoring form uses only questions
  from the set: the tenant chooses which and in what order, and cannot add a
  question or change one's wording or options. A funder that needs another
  question asks for it to be added to the set, and it is reviewed against
  this rule.
- "Led by" questions, about the people who lead or govern the applicant
  organisation, are not offered. The respondent's consent cannot cover
  special category data about other people, those people would not be told
  (UK GDPR Article 14), and the respondent's subject path would leave them
  no route to subject access or erasure. Adding them needs a new ADR that
  names their own Article 9 condition, how they are told, and their subject
  path.
- The choice goes to the solicitor (S11-03), with the demand for
  organisation-level data such as the DEI Data Standard used by some UK
  funders (GK).

### Consent and the Article 9 condition

- Monitoring has its own consent, separate from the application and from
  the party's communication consents in `party.consent`. The form opens
  with a plain statement of what is asked, why, who sees what, and that
  answering is optional, and an unticked box the applicant must tick to go
  on. The response row records the time and the privacy notice version.
- The applicant can change their answers until the round closes for
  monitoring, and withdraw them at any time. Withdrawing deletes the
  response row in the same transaction; the application is untouched, and
  aggregates already reported stand, since they hold no personal data.
- Decided: the product is built on explicit consent (Article 9(2)(a)). It
  needs no paperwork from the funder, and it can be freely given here
  because skipping costs nothing and nobody assessing the application can
  see the answers. The alternative is Schedule 1 paragraph 8 of the Data
  Protection Act 2018 (equality of opportunity or treatment), which needs
  the funder's appropriate policy document, covers only racial or ethnic
  origin, religious or philosophical beliefs, health and sexual orientation,
  and lets the subject object (GK). A funder relying on paragraph 8 uses the
  same separate opt-in, so the product needs no second path. The choice is
  marked for the solicitor (S11-03).

### Who sees what

- Reviewers and blind reviewers never see an individual answer, or whether
  one exists, anywhere. Nor do staff, in any screen, export, search result,
  notification, audit value, log line or span attribute, except through the
  two exceptions below, which need `grants.monitoring.disclose`. Request
  bodies of monitoring routes are never logged, and problems never echo a
  value (ADR 0004).
- `grants.monitoring.disclose` is a console permission that needs step-up
  ([ADR 0010](0010-authentication-security-rules.md)). Decided: it is held
  by one role bundle only, `data_protection_lead` ("Data protection lead"),
  which holds nothing else. Roles are bundles held in `packages/domain`
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)) and a membership
  holds several, so a member gets the permission as an extra role through
  the existing audited role change, and no per-member grant table is
  needed. S11-21 adds the permission and the bundle, with a test that fails
  if any other bundle holds the permission. The guide advises against
  giving the role to anyone who assesses or decides applications.
- **Rights requests.** The monitoring part of a subject access response,
  both the answers and the `grants.monitoring.*` audit events about the
  subject, is a separate output:
  - Grants' subject data contribution (ADR 0027) never yields monitoring
    rows, and the platform's subject access audit walk leaves out
    `grants.monitoring.*` events and the `grants.monitoring_response` count
    in `platform.erasure.completed`, whoever runs it. The main output
    carries a fixed line in their place, the same whether or not answers
    exist: "Equality monitoring answers are provided separately by the data
    protection lead." S11-85 builds the main output this way.
  - A member holding `grants.monitoring.disclose` makes the monitoring
    output for the person, after step-up, as a job that acts for them
    ([ADR 0009](0009-background-jobs.md)) with a job request kind of its
    own. Only that member can download it, and it is never merged into or
    attached to another member's output. Making it and each download write
    `grants.monitoring.disclosed`, a sensitive read with the subject party
    id. It is made for every request and says when no answers are held, so
    making it shows nothing. S12-15 builds it.
  - The applicant can download their own answers in the portal at any
    time, and no member sees that download.
  - Erasure deletes the answers in the worker and returns counts only, so
    nobody reads them.
- **Nobody to answer.** A subject access request must be answered within
  one month (UK GDPR Article 12(3)). While no active member holds
  `data_protection_lead`, the console's subject access screens (S12-05)
  show a warning to every member who can raise a request: "No one can
  provide equality monitoring answers. Give a member the Data protection
  lead role so subject access requests can be answered in time." It says
  nothing about any person's answers.
- **Audit.** Monitoring audit events (`grants.monitoring.*`), and the
  `grants.monitoring_response` count in `platform.erasure.completed`, are
  shown only to members holding both `platform.audit.read` and
  `grants.monitoring.disclose`. For everyone else the server leaves them out
  of the audit log screen, its exports and every other audit read, so
  nothing shows the event or a gap. The subject access audit walk leaves
  them out for everyone (above). They still carry the subject party id (ADR
  0027), through which only the monitoring output finds them.
- The monitoring form's privacy statement says that nobody who assesses or
  decides applications sees the answers, and that the person who handles
  data protection requests can see them only to answer the applicant's own
  request.
- The applicant sees their own answers in the portal, and changes them
  until the round closes for monitoring.
- Staff and tenant admins otherwise see monitoring data only as suppressed
  aggregates in `insight` (S12-45), with `insight.monitoring.report`.
  Grants shows no monitoring figures of its own, and `atlas` never uses
  monitoring data without its own ADR.

### Disclosure control

Every aggregate over special category data passes through one disclosure
engine, a pure function in `packages/domain`. grants' monitoring code hands
it unsuppressed counts inside the request; the counts are never returned,
logged or stored, and only the suppressed table leaves the request.

1. **Threshold.** Any cell counting 1 to 9 people is suppressed: shown as
   "Fewer than 10", never as a number. The platform floor is 10 because
   applicant pools are small and local, applicants often know one another,
   and reports pair answers with outcomes, so a count under 10 can reveal
   who was turned down. Zero is shown.
2. **Whole-group outcomes.** On a breakdown by outcome, a cell holding all
   or none of its group is suppressed too, because it would tell anyone who
   knows one member's answer that member's outcome.
3. **Secondary suppression.** Every row and column with a total, the totals
   included, must have no suppressed cell or at least two. While any line
   has exactly one, the smallest other non-zero cell in that line is
   suppressed, or the line's total if there is none, and this repeats until
   no line has one. A rate is computed only from cells that are shown,
   rounded to a whole percentage.
4. **Minimum group.** A table whose population has fewer than 20 responses
   is withheld whole: the report shows only "Too few responses to show this
   report. Choose a wider filter." Each table breaks one question down by at
   most one other dimension (stage reached or outcome); questions are never
   crossed with each other.
5. **Closed rounds and fixed filters.** Every report counts only rounds
   closed for monitoring, so no figure moves while applications arrive or
   answers change. A report has one filter or none: a programme, a round, a
   financial year (a round falls in the year it closed for monitoring), or a
   region at one set level. Each is an equality from a fixed list, with no
   exclusions, combinations or free date ranges. A response's region is
   copied from its submitted application, so it never moves between regions.
6. **Linked tables.** For one question and breakdown, the tenant-wide table
   and every programme, round, financial year and region table are one
   family, joined by lines: the tenant-wide table is the sum of its
   programmes, of its financial years and of its regions, and each programme
   and financial year is the sum of its rounds. On every run the engine
   suppresses the whole family together, then shows only the requested
   table:
   - **Tables.** No line has exactly one withheld table, the parent counted
     among them, and where the parent is shown, its withheld children hold
     20 or more responses between them. While a line fails, its smallest
     child still shown is withheld too. So a sibling below the minimum group
     withholds the next smallest sibling.
   - **Cells.** Each cell position, taken across a line (the parent's cell
     and the same cell in each child), is held to rule 3: never exactly one
     suppressed cell, and where the parent's cell is shown, the suppressed
     cells hold 10 or more people between them. While a line fails, its
     smallest shown non-zero cell is suppressed too. Every cell of a
     withheld table counts as suppressed.
   - Rules 2, 3 and 6 repeat until nothing changes. Suppression only grows,
     so this ends; at worst the requested table is withheld.

   Within one run, then, no shown cell, and no difference between a parent
   and the children shown beside it, comes to 1 to 9 people, and no group
   of 1 to 19 responses can be found by subtracting tables.

7. **Run log.** `insight.report_run` records each table the engine shows:
   the report, its question, breakdown and filter, the ids of the rounds it
   counted, its population and its shown cells. Before showing a table, the
   engine compares it with the log. It refuses the run if any of these,
   added or taken away, comes to 1 to 19 responses, or to 1 to 9 people in a
   cell shown in every table used:
   - the difference from an earlier run of the same table, which catches a
     withdrawal, an erasure or a deletion between runs;
   - in any line that holds the new table, the parent less those children
     that have been shown, using the new table in its own place and any
     logged run of each other table that counted only rounds within the
     parent's. This catches a sibling complement, and a parent run before a
     round closed set against children run after.

   A refusal says "This report can't be shown now, because it could be set
   against earlier reports to reveal a small group. Choose a wider filter."
   It names no table, cell or number.

The threshold (10) and minimum group (20) are held in
`insight.disclosure_rule`, versioned configuration (rule 10), and the run
log's limits follow them. A tenant may raise them, never lower them: a
check constraint holds the platform floor, and only a migration can lower
it.

### Warehouse

- Monitoring columns are special category, so the warehouse filter (ADR
  0016, `warehouseColumns()` in S10-01) never lets them through, whatever a
  tenant's personal-data setting. `grants.monitoring_response` has no
  warehouse contribution, and an aggregate has no classified source column,
  so the warehouse's column test would refuse one.
- Suppressed aggregates are not stored or loaded anywhere by the product:
  not in a table, the warehouse, a job output or a scheduled feed. The one
  exception is the run log's shown cells, kept as a disclosure control: only
  the disclosure engine reads them, and no screen, export, API response,
  job or warehouse contribution does. A staff member may view a report or
  download it as CSV within the request, as an audited export. Stored
  aggregates over many filters could be subtracted outside the run log, so
  a later ADR must add any store of published figures.

### Classification, audit and retention

- Every column of `grants.monitoring_response` is classified special
  category. Its subject path is the respondent person. It is kept under the
  tenant policy `grants.monitoring`, by default 24 months from the round's
  close for monitoring, so a round's responses leave reports together, and
  never longer than its application, with which it is deleted.
- `insight.disclosure_rule` and `insight.report_run` hold codes, ids and
  counts only, are classified internal, and are kept while the tenant is a
  customer, so the run log covers every response still held.
- Audit events hold ids, codes and counts: `grants.monitoring.saved` and
  `grants.monitoring.withdrawn` (the response id), `grants.monitoring.read`
  (the applicant viewing their answers, a sensitive read),
  `grants.monitoring.disclosed` (a rights-request read, a sensitive read),
  and `insight.report.run` (the report, filter codes, population count, and
  cells shown and suppressed). A refused run writes `insight.report.refused`
  with the same codes and no counts. No audit event holds an answer or a
  field id.

## Consequences

- Rule 2: `grants.monitoring_response`, `insight.disclosure_rule` and
  `insight.report_run` have `tenant_id`, RLS and a cross-tenant denial test.
  No exception is needed.
- Rule 3: composite foreign keys to the application, round, form version
  and person; check constraints for the platform floor and the region code
  list.
- Rule 4: saving, withdrawing, reading and disclosing monitoring answers,
  and every report run and refusal, write audit events with ids, codes and
  counts; reads of monitoring data are sensitive reads.
- Rule 5: every new column is classified with a retention rule and a
  subject path.
- Rule 6: the respondent and the actor come from the session; the server
  re-validates answers against the pinned monitoring form with the shared
  domain package.
- Rule 9: nothing about an application is decided from monitoring data.
- Rule 10: monitoring forms and disclosure rules are versioned
  configuration.
- The grants monitoring contracts (S11-54) and the `insight` contracts
  (S11-38) import the jitless zod switch first, as every contracts entry
  point does. S11-54 adds the question set and the monitoring form rules,
  and S11-21 adds `grants.monitoring.disclose` and the
  `data_protection_lead` bundle.
- S11-85 builds subject access without the monitoring part, S12-15 builds
  the separate monitoring output and the applicant's portal download, and
  S12-05 shows the warning when no member holds the role. Their tests check
  that the main output and its audit walk hold no monitoring answer, event
  or count for any requester, and that only the member who made the
  monitoring output can download it.
- S12-45 ships named attack tests against the engine, each of which must
  end in suppression or refusal: a sibling complement (a programme less two
  of its three rounds), a nested shown-cell difference (a programme and one
  round whose shown cells differ by fewer than 10), an edit between runs
  (refused after the round closes for monitoring), a withdrawal between two
  runs of one table, a programme run before a round closed set against its
  rounds run after, and a subtraction chained across two levels (tenant,
  programme, round).
- Lines protect each parent and its children. They are the usual rule for
  linked tables, not a proof against every chain of subtractions; a failing
  attack test adds a rule here.
- Suppression hides a lot in small rounds, and a small round withholds a
  larger sibling with it. Funders get usable figures by reporting over a
  programme or a financial year rather than one round.
- A withdrawal or erasure after a round closes blocks re-runs of every table
  that counted it until 20 or more responses have changed. A refusal tells
  the reader that something in that scope changed, never what or whose;
  the message says what to do.
- The Article 9 condition, the decision against "led by" questions and the
  default retention period go to the solicitor (S11-03).
- `canSee()` and S05-01's audience rules stay as they are; S11-54 adds the
  monitoring form rules.

## Dependency check

No dependency is added.
