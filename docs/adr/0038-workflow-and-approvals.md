# ADR 0038: Workflow and approvals

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Grants already has a small workflow. A round's stages are rows of
`grants.stage` (name and a deferrable `position`). Submitting puts an
application in its round's first stage, and members holding
`grants.applications.triage` move up to 200 submissions at a time into any
other stage of their round, all or none. Each move updates
`grants.application.stage_id`, appends a row to `grants.stage_transition`
(INSERT and SELECT only) and writes `grants.application.stage_changed`.
Stage changes are versioned configuration ([rule 10](../ARCHITECTURE.md)).
Nothing in grants needs anyone's approval: a move is one member's action.

The tools after grants do need approvals. `finance` (wave 2) approves
payment runs and payee bank detail changes with two named people, and its
fraud controls rest on separation of duties: the person who asks is never
the person who approves. `dca` purchase orders, `funds` expenses, `people`
offers, `governance` policies and `cases` referrals need the same shape:
someone asks, one or more other people approve, then a named person acts.
If each module builds its own, the suite has several separation-of-duties
rules and several sets of bugs. The suite plan builds one engine out of
grants by mid-December, before any of them.

`platform.approvals.read` and `platform.approvals.decide` (step-up) are
already in `packages/domain/src/platform/access.ts` and in the programme
manager role.

Constraints:

- [Architecture rules](../ARCHITECTURE.md) 2 to 10. Rule 9 matters most: no
  code path may reject, award or pay without a named user action.
- [ADR 0003](0003-query-builder-and-migrations.md): hand-written SQL, roles
  without `BYPASSRLS`, approved definer functions only, a catalogue test.
- [ADR 0004](0004-api-contract.md): route contracts with one permission and
  one scope rule; 404 for what the caller cannot reach; problem details
  never echo a value.
- [ADR 0009](0009-background-jobs.md): ids-only job payloads, a worker role,
  cross-tenant work through `app.tenant_ids()`.
- [ADR 0010](0010-authentication-security-rules.md): step-up means
  re-authentication in the last 5 minutes.
- [ADR 0016](0016-modular-suite-and-shared-warehouse.md): modules own their
  schemas, cross-module foreign keys only to published keys, composite with
  `tenant_id` and `ON DELETE RESTRICT`; a module switched off answers 404.
- [ADR 0017](0017-bespoke-crm-party-core.md): actors are memberships.
- [ADR 0034](0034-event-outbox.md): events are `<module>.<fact>.v<n>`, with
  ids, enums, integers and timestamps only, and no restricted value.
- [ADR 0037](0037-record-level-permissions.md): reach, the shared list
  filter and read-only break-glass.
- ADR 0041 (money and the finance boundary) and ADR 0043 (payee bank
  details) are being drafted. Their questions are left to them.

`app.config_version` names its entity with `entity_type` and `entity_id`
and no foreign key. That is deliberate: it is a history of configuration,
read by people, that must name any configuration row in any module and
outlive edits to it. It never authorises anything.

## Options considered

The engine:

1. **Each module builds its own approvals.** No shared code; several
   separation-of-duties rules to review and keep in step.
2. **A general workflow or BPMN engine, or a library.** Parallel branches,
   scripted conditions and timers that act. Far more than "ask, approve, act",
   timers that act break rule 9, and it adds a dependency.
3. **A small engine:** typed definitions (states, transitions, approval
   steps), requests that need N distinct approvers, checked by shared pure
   functions and again by the database.

Linking a request to the record it is about:

4. **`subject_type` and `subject_id` on the request,** as `config_version`
   does. No foreign key, so a request can name a deleted record, another
   tenant's record or a record of a switched-off module, and nothing ties its
   retention to the record's. Against rule 3.
5. **One nullable foreign key per kind of record on the platform table.** The
   platform schema changes with every module, and the platform references
   module tables, the wrong way round for ADR 0016.
6. **A module-owned link table per kind of record,** with composite foreign
   keys to both sides, as [ADR 0030](0030-files-and-reverse-proxy.md) does
   for files.

Where definitions live:

7. **In code only.** A tenant cannot ask for more approvers on a payment.
8. **Written by each tenant in a designer.** A large editing and validation
   surface, and a tenant could remove an approval step a control relies on.
9. **Shipped by the module in code and stored per tenant as versions,** where
   a tenant may only raise approver counts and set reminder timing.

Where separation of duties is enforced:

10. **In the policy module only.** One bug or one direct query bypasses it.
11. **In the policy module and again in the database.**

## Decision

Options 3, 6, 9 and 11.

### Words

- **Definition:** a module's named workflow, `<module>.<name>`, such as
  `finance.payment_run`: states, transitions between them, and approval
  steps.
- **Approval step:** what must be approved before a transition, and by how
  many distinct members holding which permission.
- **Request:** one ask for one approval step on one record, the **subject**.
- **Decision:** one member's approve or reject on one request.

### Definitions

- The contract is `packages/domain/src/workflow/` (S11-108):
  `defineWorkflow()` and a strict schema. A definition has:
  - `states`, with stable ids and labels, one of them initial;
  - `transitions`: from, to, the console permission of the same module the
    actor must hold, a label that says what happens, and optionally the
    approval step that must be approved first;
  - `approvalSteps`: a stable id, a label, approve and reject button labels
    ("Approve payment", "Reject payment"), the permission an approver must
    hold, `approvers` (1 to 5), `movesMoney`, and optional
    `remindAfterDays` and `dueAfterDays`.
- A definition needs no terminal state. A transition from a state marked
  terminal is refused, as is an unknown or duplicate id, a state no
  transition reaches, and any timer that names a transition.
- A definition holds no tenant, actor, membership or free text.
- **Stored per tenant.** `app.workflow_definition` holds one row per key in
  the tenant; `app.workflow_definition_version` holds its numbered versions,
  each a whole document, INSERT and SELECT only, unique per definition and
  number. The server checks every document with the schema and against the
  module's shipped definition: the same states, transitions, steps and
  permissions, with approver counts no lower than shipped and only the
  reminder days free. So a tenant can tighten a control but never remove or
  weaken one.
- Switching a module on writes version 1 of each of its definitions, as
  shipped, in the same transaction and with the switching admin as author.
  Raising a count or changing reminder days writes the next version under
  `platform.settings.manage`, on a step-up route.
- Every version writes a `config_version` row with entity type
  `platform.workflow_definition`, the definition's id, the same number, the
  author and the diff (rule 10).
- Grants' stage workflow is derived from `grants.stage`, not stored (see
  "Grants refit").

### Requests, decisions and link tables

S12-69 builds the platform tables, all tenant tables under ADR 0003. It
depends on S12-70, which adds `app.current_membership_id()` (ADR 0037) and
the session token setting below, so every actor column is checked against
the verified session from the first migration.

**The session actor.** Decided: the database checks every requester,
decider and closer against the verified session, not only against the
membership setting, which any app role can change with `set_config`
(ADR 0037, "Threats").

- `withTenant()`, given the verified session as its member source, also
  sets `app.session_token_hash` transaction-locally, as a bound parameter,
  from the token hash its session lookup already holds. A job source sets
  no token, so jobs can neither ask nor decide. `DISCARD ALL` clears it,
  `withTenant()` refuses a connection where it is already set, and a
  Semgrep rule bans naming it outside `withTenant()`, as for the membership
  setting.
- `app.session_actor()`, an invoker function (no new definer function),
  returns the membership id and the session's `reauthenticated_at` only
  when the setting names a live console session through
  `auth.session_context()`, that session's active tenant is the current
  tenant, and its user is the user of `app.current_membership_id()`, whose
  membership is active. Otherwise it returns nothing, and every trigger
  below refuses.
- App roles read `auth.session` only through `auth.session_context()`,
  which takes a hash and returns none, so an injected query cannot learn
  another member's token hash. Changing either setting lets it act only as
  the member whose session it already runs in.

The tables:

- `app.approval_request`: `definition_version_id`, with a composite foreign
  key to the version it was made under; `definition_key`, that version's
  definition key; `step_id`; `required_approvals`, 1 to 5; `status`
  (`pending`, `approved`, `rejected`, `withdrawn`); `requested_by` and
  `closed_by`, composite foreign keys to `app.membership`; `close_reason`, a
  checked code for withdrawals; `requested_at`, `due_at`, `closed_at`,
  `updated_at` and `retain_until`. No subject columns, no amount and no free
  text. Unique on `(tenant_id, id, definition_key, step_id)` for link
  tables.
  - `app_api` may insert only `tenant_id`, `definition_version_id`,
    `step_id` and `requested_by`. A `BEFORE INSERT` trigger refuses unless
    `requested_by` is `app.session_actor()`'s membership, refuses a version
    that is not its definition's latest, and reads the pinned version: it
    sets `definition_key` from its definition, refuses a `step_id` its
    document does not have, and sets `required_approvals` from that step's
    `approvers` and `due_at` from its `dueAfterDays`. It sets `status` to
    `pending` and `requested_at` to `now()`. Nothing the caller supplies
    decides the key, the count, the dates or the status.
  - On a pending request `app_api` holds `UPDATE` only on `status`,
    `closed_by` and `close_reason`. A `BEFORE UPDATE` trigger refuses a
    change to any other column, so `requested_by`, `required_approvals`,
    `definition_key`, `step_id` and `definition_version_id` are fixed once
    inserted. It sets `closed_at`, `updated_at` and `retain_until` itself
    and checks the closing (see "Separation of duties"). A closed request
    never changes. No other app role may update, and no app role may delete.
- `app.approval_decision`: `request_id`, a composite foreign key to the
  request; `decided_by`, a composite foreign key to `app.membership`;
  `outcome` (`approve`, `reject`); `reason_code`, required for a rejection;
  `decided_at` and `retain_until`, set by the database. Unique on request and
  decider. `app_api` may insert only `tenant_id`, `request_id`, `decided_by`,
  `outcome` and `reason_code`. INSERT and SELECT only for every app role.
- **Link tables.** Each module that asks for approvals owns a table per kind
  of subject, such as `finance.payment_run_approval`, holding `tenant_id`,
  the subject's id, `approval_request_id`, `definition_key`, `step_id` and,
  where the subject has versions, the version approved. Composite foreign
  keys go to the subject and to
  `app.approval_request (tenant_id, id, definition_key, step_id)`, both
  `ON DELETE RESTRICT`, so a link states the definition and step its
  request is for. A `CHECK` fixes `definition_key` to the definitions the
  table serves, and the catalogue test fails if two link tables allow the
  same key, so a request can be linked from one table only. The request id
  is unique there, so a request has one subject; a subject may have many
  requests over time. The link is also unique on
  `(tenant_id, approval_request_id, definition_key, subject id, step_id)`
  for the module's action log (see "What an approval approves"). INSERT and
  SELECT only for every app role; only the purge deletes (below).
  - Every link table has a `BEFORE INSERT` trigger running the shared
    platform function `app.check_approval_link()`. It locks the request row
    (`FOR SHARE`, so it waits for any decision or closing) and refuses a
    request that is not pending or already has a decision. A request is
    linked once, when it is made, and never after anyone has decided it.
    The catalogue test fails if any table with a foreign key to
    `app.approval_request` lacks the trigger.
- `ctx.workflow.request()` (S12-77) inserts the request and the module
  inserts its link in the same transaction. Every read and decision reaches
  a request through its module's link table and that module's scope rule,
  so a request left without a link by a bug answers 404 and can never be
  decided.
- This amends ADR 0016: `app.approval_request` joins the published keys a
  module may reference.

**Why not `config_version`'s pattern.** A configuration history row records
that something changed; nothing acts on it. An approval gates an action on
a real record, and its whole value is that the record it approved is the
record acted on. With a type and an id and no foreign key, the database
could not stop a request naming another tenant's record, a record that no
longer exists or one of a module switched off, and the request's retention
could not be tied to its subject. The link table gives an enforced key, row
level security on both sides and a path for retention, at the cost of one
small table per kind of subject.

**Retention.** Decided: requests, decisions and link rows are audit
evidence, kept under the tenant's audit rule like the audit events that
record them, and the link makes the subject outlive them.

- The database sets `retain_until`, as it does for `app.audit_event` (ADR
  0003): on a decision at insert, from `decided_at`; on a request when it
  closes, from `closed_at`; each from the tenant's audit rule in
  `app.retention_policy`, ignoring any supplied value. A `CHECK` keeps each
  at least 12 months after its start, the platform minimum, and a pending
  request has none, so it is never purged.
- A link row has no date of its own, since it is written before its request
  closes. It goes with its request.
- `app.purge_expired_audit()` (ADR 0003) also purges approvals, in the
  current tenant only: for each closed request past its `retain_until` whose
  decisions are all past theirs, it deletes the decisions, the link row and
  the request, in bounded batches, and its audit event counts them with the
  events. Its owner's only `DELETE` policies on the three kinds of table
  match those rows, so even the purge cannot remove an approval inside its
  retention.
- Each migration that adds a link table grants the purge owner `SELECT` and
  `DELETE` on it with that policy, and adds its `DELETE` to the function.
  The catalogue test fails if any table with a foreign key to
  `app.approval_request` is missing from the function or lacks the policy.
- An approval that an action used stays while the module's log row for
  that action exists: the purge's `DELETE` for a link table skips rows its
  module's action log still references, so the evidence of an approved
  action lasts as long as the action's record.
- A subject cannot be deleted while a link row names it
  (`ON DELETE RESTRICT`). Its module's purge removes its own log rows first
  and skips the subject until its approvals are purged, so a subject
  outlives them. Erasing personal values in a subject uses ADR 0027's keys
  and is not held up by a link. Whether finance needs a longer audit floor
  for payments is ADR 0041's question.
- Definitions and their versions are kept for the life of the tenant, since
  requests pin them.

### Separation of duties

Decided: the approver is never the requester. A step needs `approvers`
distinct members, and one member counts once. One rejection closes the
request as rejected, in the rejecter's transaction. A decision is final.
The requester does not choose the approvers: any member who passes the
checks below may decide.

The policy module checks first, through `checkApprovalDecision()` in the
domain package, with the approver's permissions resolved from the session
at the time of the decision:

- the request is `pending`;
- the approver is not the requester and has not decided this request;
- they hold `platform.approvals.decide` and the step's permission;
- they reach the subject through its module's scope rule without
  break-glass (ADR 0037);
- every approver eligibility rule registered with the policy module agrees
  (none in v1; see "Boundaries").

The database checks again, whatever the server does:

- Composite foreign keys and row-level security: a membership or request of
  another tenant cannot be named.
- The unique key on request and decider refuses a second decision.
- A `BEFORE INSERT` trigger on `app.approval_decision` locks the request row
  (`FOR UPDATE`), then refuses a decider other than `app.session_actor()`'s
  membership (and refuses when it returns nothing), a session whose
  `reauthenticated_at` is more than 5 minutes before the database's
  `now()`, a decider who is the requester, a request that is not pending, a
  request that already has a rejection, and an approval when the request
  already has its required approvals. It sets `decided_at` and
  `retain_until`.
- A deferred constraint trigger on `app.approval_decision` refuses, at
  commit, a rejection whose request is not closed as `rejected` by its
  decider. So a rejection can never be left on a pending request.
- The request triggers above fix who asked, the definition, the step and
  the count. The `BEFORE UPDATE` trigger allows only these closings, each
  with `closed_by` equal to `app.session_actor()`'s membership:
  - `pending` to `approved`: no rejection exists, exactly
    `required_approvals` approvals exist, and one of them is by `closed_by`;
  - `pending` to `rejected`: `closed_by` made a rejection of it;
  - `pending` to `withdrawn`: `closed_by` is the requester, with a
    withdrawal code other than `requester_removed`; or the code is
    `requester_removed` and the requester's membership is `removed` (see
    "Withdrawal").
- Refusals raise a stable SQLSTATE and constraint name, never a value.

The database checks; it never changes a status by itself. The decision that
completes the step closes the request in the decider's transaction, after
the service has locked the request row, so two approvers deciding at once
are taken one at a time and the second is refused with "already decided".

**Step-up.** Decided: every approve and every reject needs step-up within
5 minutes (ADR 0010), on every definition. There is no per-definition
switch: decisions are rare, and this covers every decision where money
moves. Three things make it hold whichever code asks:

- Decisions are made only through the platform decide route (S12-77), whose
  contract permission is `platform.approvals.decide`. That permission
  carries the step-up flag, so the route lint requires `stepUp: true`. No
  module route records a decision.
- `ctx.workflow.decide()` itself refuses, with the same problem as the
  route's step-up check, unless the session re-authenticated in the last 5
  minutes, whatever route calls it. So a module route declared under its own
  permission, such as a finance "approve payment" route without the flag,
  cannot decide without step-up.
- The decision trigger checks the session's own `reauthenticated_at`
  against the database's clock, so a direct query cannot decide without a
  recent step-up either.

Withdrawing needs no step-up. Making a request needs whatever the subject
module's route needs.

Tests the database work (S12-69) and the service (S12-77) must name:

- the requester approves their own request: refused by both;
- the same approver decides twice: refused by both;
- a member of another tenant decides: 404 from the server, foreign key
  refusal from the database;
- a member without the step's permission decides: refused by the server
  (the database does not know permissions, so it is tested there with a
  suspended member instead);
- an approval beyond the required count, a decision on a closed request, and
  two approvers completing a one-approver step at once;
- a rejection inserted without closing the request: refused by the database
  at commit; and, with that deferred trigger set aside inside a rolled-back
  test transaction so each layer is tested on its own, a rejection left
  pending then approvals by others, and a closing to `approved` when a
  rejection exists: both refused by the database;
- on a pending request, an update of `requested_by`, `required_approvals`,
  `definition_key`, `step_id` or `definition_version_id`: refused by the
  database, including the requester who sets `requested_by` to someone else
  and then approves, and the requester who lowers 2 to 1 and closes;
- a request inserted with an unknown step, or pinning a version that is not
  the latest: refused; one inserted with a `required_approvals`, `status` or
  `definition_key` of its own: the pinned version's values and `pending` are
  stored;
- a request, decision or closing whose actor is not `app.session_actor()`'s
  membership, with either setting unset, or with a token hash of a revoked,
  expired or portal session or of another tenant's session: refused by the
  database;
- one transaction that asks as A, then uses `set_config` to become B and
  approve, then C to approve and close: refused by the database at B's
  decision, because the session is still A's;
- a decision on a session without step-up in the last 5 minutes: refused
  by the service through any route, and by the database, with nothing
  written;
- a request linked from a second link table (of another definition, with
  the same step id), and a request linked after it is approved or after any
  decision: refused by the database;
- the module's action using an approved request twice, using it for another
  subject or another definition's step with the same id, or using a request
  that is not approved: refused by the database (S12-84's and each module's
  tests follow the same pattern);
- the purge: a pending request, or a closed one inside its retention, is
  kept; an expired one goes with its decisions and link row, only in the
  current tenant, and the purge's audit event counts them.

### Versions, deadlines and withdrawal

- **Pinned.** A request keeps the definition version it was made under, as
  an application keeps its form version (rule 7). A tenant raising a count
  later affects only new requests.
- **Humans decide** (rule 9). Nothing in the engine moves a subject. An
  approved request lets a named member make the transition once; the
  module's own route does that (see "What an approval approves").
- **Reminders only.** A daily worker job lists tenants through
  `app.tenant_ids()` and, in each, reminds the members who may decide a
  request pending longer than `remindAfterDays`, at most once a day per
  request. Payloads hold ids only.
- **At a deadline nothing changes state.** Past `due_at` the request stays
  pending. It is flagged as overdue in the inbox and on the subject, and the
  reminder goes to the requester too. No job decides, withdraws or closes a
  request.
- **Withdrawal.** The requester may withdraw a pending request with a reason
  code. Removing a membership withdraws that member's pending requests in
  the same transaction, as part of the remover's named action, with the code
  `requester_removed` and the remover as `closed_by`; the trigger allows a
  withdrawal only by the requester or in that case. A suspended member's
  requests stay open.
- **After rejection or withdrawal** the request is closed for good. Asking
  again makes a new request, and a new link row, under the current
  definition version, so the history shows both. An approver who decided in
  error tells the requester, who withdraws and asks again.
- **Role changes.** Permissions are checked when each decision is made.
  Decisions already made stand, including those by a member removed since.

### What an approval approves

An approval approves one action, once, on the subject as it was when asked.

- **The subject as asked.** The module pins it: either its link row names an
  immutable version of the subject, as applications pin form versions, or it
  refuses changes to the subject while a request is pending or approved and
  not yet acted on. Any change after approval needs a new request. The
  engine keeps no copy or hash of the subject.
- **One action, once.** The module's named action checks, with the domain
  package's `checkApprovalForAction()` (S11-108), that the request is
  approved, is linked to this subject, belongs to this definition key and is
  for the step this transition names, and that the pin still holds. It then
  records `approval_request_id` in its append-only transition or action log,
  in the same transaction as the action.
- The database holds the same line. The log holds `definition_key` and
  `step_id`, and its composite foreign key goes to the link row on
  `(tenant_id, approval_request_id, definition_key, subject id, step_id)`,
  so the request must be linked to this subject for this definition and
  step. A `CHECK` fixes the definition key and ties each transition that
  needs approval to its step id. The log is unique on
  `(tenant_id, approval_request_id)`, so each approval authorises exactly
  one action, and a `BEFORE INSERT` trigger refuses a request that is not
  `approved`.
- So an approval cannot be used again after the subject cycles back to the
  earlier state, nor for another definition, step or subject, even where
  two definitions share a step id. Doing it again needs a new request.

### Reason codes

Decided: reasons are codes from checked lists, with no free text in v1.

- Rejection: `incorrect_details`, `missing_evidence`, `outside_policy`,
  `duplicate`, `other`.
- Withdrawal: `no_longer_needed`, `made_in_error`, `changes_needed`,
  `requester_removed`.

Decisions are INSERT-only and kept under the audit rule. Free text
would name people and so need ADR 0027's encryption under a subject key and
an erasure path through an append-only table. A conversation about a
rejection belongs with the subject, in the module's notes (being drafted).

### Grants refit

S12-84 moves stage moves onto the engine with no change anyone can see:

- `grants.stage` stays grants' configuration, versioned as today. A grants
  adapter builds each round's definition at run time: its states are the
  round's stages in position order, its initial state is the first stage
  (entered on submit, as now), and it allows a move from every stage to
  every other under `grants.applications.triage`, with no approval step.
- Derived definitions are not stored and not pinned. Applications point at
  stage rows by foreign key, a stage in use cannot be deleted, and the
  round's stage history is already in `config_version`.
- `grants.stage_transition` stays the record, INSERT and SELECT only.
  Nothing is written to the approval tables.
- A bulk move checks every application with `canTransition()` before any
  write and stays all or none, with the same problems.
- `grants.application.stage_changed`, the routes, the permissions, the
  limits and the OpenAPI document are unchanged, and no step-up is added,
  so the demo end-to-end test passes as it is.
- Recording a decision and releasing it stay separate grants operations
  (rule 8). Neither is a stage move or an approval, and moving into a
  Decision stage releases and sends nothing. An approval outcome never
  stands in for a grants decision.
- If grants later puts an approval on a move, it adds a stored definition and
  a link table from application to request, and the move stays the named
  member's action once approved.

### Boundaries

- **The engine owns** definitions, requests, decisions, the
  separation-of-duties checks, reminders and the approvals inbox. It does
  not own the subject, its pin, amounts, or the action taken after approval.
- **Payee bank details** (ADR 0043, being drafted): a bank detail change is
  approved by two people through the engine, as a `finance` definition with
  `movesMoney`. Encryption, the cooling-off period, Confirmation of Payee and
  notices to the payee belong to `finance`, which checks them before its own
  named action. A cooling-off period is not an engine timer.
- **Money** (ADR 0041, being drafted) decides where money moves.
  `movesMoney` marks every such step so that ADR, audit and later rules can
  find them.
- **Delegated authority.** `governance` (wave 2) adds its matrix as an
  approver eligibility rule registered with the policy module: given the
  step, the request and the approver, it answers yes or no, reading what it
  needs, such as an amount, through the subject module's contract. Rules can
  only narrow who may decide, never widen it. The engine knows nothing of
  `governance` now.
- **Reach** (ADR 0037). A member sees and decides a request only if they
  reach its subject through the subject module's scope rule. The inbox list
  and its counts use the shared list filter through each link table, without
  break-glass, so a request on a restricted record never appears for anyone
  not named on it. Break-glass shows a request only on the record's own
  pages, read-only, as for any child of the record, and never lets anyone
  decide.
- **Module off.** A request whose definition belongs to a module switched
  off answers 404 and leaves every list.

### Audit and events

- Audit actions, through `defineAuditActions('platform', …)` in
  `packages/domain/src/workflow/`: `platform.approval.requested`,
  `platform.approval.approved`, `platform.approval.rejected`,
  `platform.approval.withdrawn`, and `platform.approval.viewed` for
  sensitive reads. Each holds ids and codes only: request, definition
  version and step ids, outcome, reason code, and approvals received and
  required. Where the subject is a person, the module supplies the subject
  party id.
- No reason text exists to classify. Every column of the four tables is
  internal: ids, codes, counts and times.
- **Sensitive reads.** Each module says, per definition, whether reading a
  request is a sensitive read of its subject (a person's bank details
  change is; a purchase order is not). If so, reading the request writes
  `platform.approval.viewed`.
- **Event.** `platform.approval_decided.v1` is published when a request
  closes as approved or rejected, not on each decision or a withdrawal:
  `requestId`, `outcome` (`approved` or `rejected`) and `decidedAt`. Its
  read permission is `platform.approvals.read`. An approval outcome is an
  internal staff step, never held back for release (rule 8), so the enum
  meets ADR 0034's rule. ADR 0037 already keeps events about restricted
  records out of `connect`.

### Threats

S12-54 writes the threat model from this ADR. The main threats and what
answers each:

- **Collusion.** Two members can agree to approve each other's requests.
  Distinct members are a floor, not a guarantee. Answered in part: tenants
  raise counts; every decision is audited and step-up; the delegated
  authority matrix narrows who may decide.
- **Self-approval.** Refused by policy and database. A second account for
  one person is limited by invitation through tenant admins and single
  sign-on.
- **Choosing a friendly approver.** The requester names nobody.
- **Changing the subject after approval.** The module's pin, checked by its
  named action.
- **Role changes mid-request.** Permissions are checked at each decision.
- **A removed member's requests.** Withdrawn with the removal.
- **Lowering a control.** A tenant can only raise counts, on a step-up
  route, versioned and audited. A request must pin its definition's latest
  version, and its count is copied by the database, so an older, lower
  count cannot be chosen.
- **A decision by direct query.** On an app role a query can insert only a
  request's version, step and requester, or a decision's request, decider,
  outcome and reason, and can update a pending request only to close it.
  The triggers set the definition key, the count and the dates, refuse
  every other change, refuse any decision on a request with a rejection,
  and refuse any requester, decider or closer other than
  `app.session_actor()`'s membership. So a direct query cannot approve its
  own request, lower a count, reopen a request, push past a rejection or
  decide without a recent step-up. Nor can it ask or decide as someone
  else, even by tampering with the membership setting (next).
- **Tampering with the membership setting.** As ADR 0037 says, an injection
  that reaches `set_config` can change `app.membership_id` for one
  transaction. For approvals that is not enough: `app.session_actor()` ties
  the membership to the live session named by `app.session_token_hash`,
  and an app role cannot read another member's token hash. So the
  injection still acts only as the member whose session it runs in, and
  cannot ask as one colleague and approve as another. The Semgrep rules,
  the empty-setting checks, `DISCARD ALL` and parameterised queries limit
  the tampering itself, as for the tenant setting. What remains is an
  injection acting as its own member, which the rules above already bound,
  or one that learns another member's live token hash. App roles cannot
  read hashes from `auth.session`, and `withTenant()` passes its own only
  as a bound parameter, so no other connection's query text shows it.
- **Replaying an approved request.** One approval used for a second action,
  after the subject returns to an earlier state, or for another definition,
  step or subject. The module's action checks subject, definition key and
  step. In the database, a request carries its definition key, each link
  table accepts only its own definitions' keys, a request is linked only
  while pending and undecided, and the log's unique key on the request and
  foreign key to the link row allow each approval exactly one action.
- **Replaying an approve.** The decide route takes an idempotency key
  ([ADR 0028](0028-idempotency-keys.md)), and the unique key refuses a
  second row.
- **Probing.** Unreachable requests answer 404, and lists and counts are
  filtered.

### Not decided here

- Parallel branches, several steps in one request, delegation while away,
  reassigning and escalation. A flow with two steps makes two requests at
  two transitions.
- Free-text reasons.
- How a release brings a changed shipped definition to tenants that already
  have it; ADR 0029's tenant-by-tenant data migrations are the likely route.
- Whether the person who acts after approval may be the requester or an
  approver: ADRs 0041 and 0043.
- The delegated authority matrix itself.

## Consequences

- One engine for every tool after grants: a module adds a definition and a
  link table, and inherits separation of duties, step-up, reminders, the
  inbox, audit and the event.
- Rule 2: the four new tables have `tenant_id`, forced row-level security
  and cross-tenant denial tests, plus a test that a link table cannot point
  at another tenant's request.
- Rule 3: composite foreign keys throughout, checks on every status, outcome
  and code, and no polymorphic reference.
- Rule 4: every request, decision, withdrawal and sensitive read writes an
  audit event with ids and codes only; definition changes write
  `config_version`. Decisions and link rows are never updated, a request
  only to close it, and only ADR 0003's audited purge deletes them.
- Rule 5: every new column is classified internal. Requests, decisions and
  link rows are kept under the tenant's audit rule from a `retain_until` the
  database sets, never below the 12-month minimum, and a subject outlives
  its approvals; the classification map needs a rule that says so.
  Definitions last as long as the tenant.
- Rule 6: the requester, the approver and the closer always come from the
  session, and the database refuses any other than the membership of the
  live session named by the transaction's token hash
  (`app.session_actor()`). The server re-validates every decision with
  the domain package's functions, and no request schema names a tenant or a
  member.
- Rule 7: requests pin their definition version.
- Rule 8: grants decisions stay outside the engine; approvals are never
  released to applicants.
- Rule 9: no timer or job changes a request or a subject.
- Rule 10: definitions are versioned with author and diff.
- `packages/domain/src/workflow/` imports the jitless zod switch
  (`packages/domain/src/jitless`) before anything else and is covered by the
  jitless test, as every contracts entry point is.
- The approvals screens (S12-86) meet WCAG 2.2 AA and
  [the content style](../CONTENT-STYLE.md): buttons say what happens, using
  the step's labels, such as "Approve payment".
- The contracts follow this ADR where earlier plans differ: no reason text,
  no per-step step-up flag (every decision needs it), no required terminal
  state, the audit actions above rather than one "decided" action, and two
  definition tables beside the two instance tables.
- Amendments, with status lines in a later housekeeping change: ADR 0016's
  published keys gain `app.approval_request`; ADR 0003's
  `app.purge_expired_audit()` also purges expired approvals and link rows,
  and its owner gains the grants and policies for them; ADR 0037's
  `withTenant()` also sets `app.session_token_hash` from a session source,
  under the same rules as the membership setting.
- The catalogue test gains three checks: every table with a foreign key to
  `app.approval_request` has the `app.check_approval_link()` trigger and a
  line in the purge, and no two link tables allow the same definition key.
- Build order: contracts (S11-108), the membership and session token
  settings (S12-70), schema
  (S12-69, after S12-70), service and inbox API (S12-77), grants refit
  (S12-84), screens (S12-86), end-to-end tests (S12-93), threat model
  (S12-54).
- Costs we accept: one link table per kind of subject, a row lock per
  decision, a session lookup per request, decision and closing, a log entry
  per approved action, a line in the purge per link table, and no free text
  on a rejection.

## Dependency check

No dependency is added, and no workflow or rules library is used. The engine
is TypeScript in the domain package and SQL in hand-written migrations.
