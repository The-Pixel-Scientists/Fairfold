# ADR 0037: Record-level permissions

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Inside a tenant, access is decided by permission and scope rule
([ADR 0004](0004-api-contract.md)). Every route names one permission and one
rule, the module that owns a rule registers its resolver, and a resolver
answers for one record: true, or 404 exactly as for a record that does not
exist. Staff routes almost all use `tenant`, so anyone holding the
permission reaches every record in the tenant. Reviewers are the exception:
`assigned_review` reaches only their own assignments, and blind review drops
identity from what they are sent.

The tools after grants need more. `governance` keeps a safeguarding concerns
log that only named people may read. `cases` gives each caseworker their
caseload and keeps some cases from everyone but the case team. `volunteers`
holds criminal records check outcomes. Each needs the same three things:
reach that follows assignment (caseloads), records only named people reach
(restriction), and an emergency way in (break-glass). If each module
invents them, the suite has three models and three sets of bugs.

The resolver answers one record at a time. Lists are where records leak:
the scope code says "a route that lists records applies its filter in the
handler", so every list, search, count and export is its own filter, and
nothing proves it agrees with the detail route.

The suite plan disagrees with itself. Its identity section (2.2) lists
"linking staff to party people, teams, delegated administration, break-glass
access" under "not now". Its quarter-by-quarter plan (4.5) brings
record-level permissions forward into the November and December platform
wave, because `governance`, `volunteers` and `cases` depend on it.

Constraints:

- Roles are seeded bundles of permissions held as data, and code checks
  permissions, never role names
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)). A second kind of
  role would undo that.
- [ADR 0003](0003-query-builder-and-migrations.md): forced row-level
  security, a top-level tenant term in every permissive policy, roles
  without `BYPASSRLS`, approved definer functions with their own `NOLOGIN`
  owners ([ADR 0023](0023-function-owner-memberships.md)), and a catalogue
  test. `withTenant()` in `packages/db/src/tenant-context.ts` is the one
  place that sets `app.tenant_id`.
- [ADR 0009](0009-background-jobs.md): a job a user asked for runs from a
  `job_request` row, intersected with the requester's current scope.
- [ADR 0010](0010-authentication-security-rules.md): step-up means
  re-authentication within the last 5 minutes.
- [ADR 0017](0017-bespoke-crm-party-core.md): `party.person.user_id` is the
  account that is this person, unique within a tenant and set only from the
  session, and `app.membership` joins the same account to the tenant.
- [ADR 0025](0025-party-matching-merge-and-search.md): search respects scope
  rules, and searches that return people are audited sensitive reads.
- [ADR 0027](0027-erasure-across-modules-and-audit.md): erasure and subject
  access run in the worker through module contributions, and personal values
  kept beside the audit trail are encrypted under a subject's key.
- Every staff or reviewer read of an application is audited; reading the
  audit log is not.
- [Architecture rules](../ARCHITECTURE.md) 2 to 6, 9 and 10.
- ADR 0038 (workflow and approvals) is being drafted beside this one. Its
  questions are left to it.

## Options considered

Where reach is enforced:

1. **Each handler filters, as now.** No shared code, and nothing proves a
   list agrees with its detail route.
2. **Scope resolvers plus one shared list filter.** One helper builds the
   reach condition; detail resolvers and list queries both use it. Enforced
   in application code only, so a query that skips it leaks.
3. **Option 2, plus a row-level security term on restricted records,** keyed
   on a new `app.membership_id` setting. A second line that holds whatever
   the code does, at the cost of a setting every connection path must
   handle.
4. **All reach in row-level security,** caseloads included. The database
   does not know which route, permission or scope rule a query serves: a
   manager and a caseworker read the same table with different rules. It
   would need permissions in the database.

Where reach is recorded:

5. **One platform table naming any record** by module, kind and id. A
   polymorphic reference with no foreign key, against rule 3.
6. **A `restricted` column on each restrictable record and a module-owned
   access table per record,** with composite foreign keys to the record, the
   membership, the team and the break-glass grant.

Teams:

7. **Teams as permission bundles.** A second role system.
8. **Teams as reach only.** A team is a list of members that access rows can
   name. It grants no permission.

Break-glass:

9. **None: ask a named member.** Fails at night and when the named people
   are the problem.
10. **An admin grants temporary access.** Puts one more person between an
    emergency and the record, and gives tenant admins a quiet way in.
11. **Self-service with hard limits:** a permission, step-up, a reason, a
    time limit set by the database, an alert at once and a review after.

## Decision

Options 3, 6, 8 and 11.

### Scope of this ADR

- The suite plan's 4.5 overrides 2.2's "not now" for teams, caseloads,
  restricted records and break-glass. Delegated administration (tenant
  admins handing part of their power to others) stays "not now".
- Linking staff to party people needs no new table. The link exists:
  `party.person.user_id` names the account, and `app.membership` joins that
  account to the tenant (ADR 0017). Any join from a member to their person
  goes through those two.
- Grants records are not restrictable here. `assigned_review` and blind
  review are unchanged (see "Reviewers and blind review").

### Words

- **Reach:** whether a member may reach a record at all. Permissions say
  what they may do; reach says to which records.
- **Restrictable record:** a record type whose module declares it can be
  restricted, such as a case or a safeguarding concern. A **restricted**
  record is one whose `restricted` column is true.
- **Access row:** a row in the record's module-owned access table that gives
  one member, or one team, reach to one record.

### Teams

- `app.team` holds `name` (1 to 100 characters, unique within the tenant
  among teams not archived) and `archived_at`. `app.team_member` holds
  `team_id` and `membership_id`, unique per pair, with composite foreign
  keys `(tenant_id, team_id)` to `app.team` and `(tenant_id, membership_id)`
  to `app.membership`. Both are tenant tables with the usual audit columns.
- Teams grant reach and nothing else. A member's permissions come only from
  their roles. A team has no kind, no permissions and no settings that
  behave like any.
- Code never checks a team's name. Module code refers to a team only by id,
  in access rows. A Semgrep rule bans naming `app.team` or
  `app.team_member` outside the platform team handlers, the migrations and
  the reach functions below.
- No nesting. A team holds members, not teams.
- A new permission, `platform.teams.manage` (console, `tenant` scope, step-up
  for changes), creates, renames and archives teams and adds and removes
  members. Each change writes an audit event: `platform.team.created`,
  `.renamed` and `.archived`, and `platform.team_member.added` and
  `.removed`. Creating, renaming and archiving also write a
  `config_version` (rule 10): other configuration, such as a module's
  default team, refers to them. Adding or removing a member is an access
  change, audited like a role change and not versioned.
- An archived team grants nothing. Its access rows stay as history.
- Removing a membership deletes its team rows in the same transaction.
  Suspension leaves them, since a removed membership never returns and a
  suspended one has no reach while suspended (below).
- Teams are part of the platform, which is always on.

The existing `/platform/team` contracts manage the tenant's members.
Screens keep "members" for people and use "teams" for these groups, so the
two never share a label.

### Access rows and caseloads

Each restrictable record type has an access table in its own module, never
a platform table naming any record. Using `cases` as the worked example:

- `cases.case` gains `restricted boolean NOT NULL DEFAULT false`.
- `cases.case_access` holds:
  - `case_id`, with `(tenant_id, case_id)` to `cases.case`;
  - exactly one of `membership_id`, to `app.membership`, or `team_id`, to
    `app.team`, by a check;
  - `kind`: `assigned` (in the member's or team's caseload), `named` (reach
    without being in the caseload, such as a safeguarding lead) or
    `break_glass`, by a check;
  - `break_glass_id`, set if and only if the kind is `break_glass`, which
    also needs `membership_id`, with
    `(tenant_id, break_glass_id, membership_id, record_type, case_id)` to
    `app.break_glass (tenant_id, id, membership_id, record_type, record_id)`,
    where `record_type` is a column fixed to `'cases.case'` by a check. A
    grant therefore opens only the record it was opened for, and only for
    the member who asked for it. `break_glass_id` is unique where set.
- Every foreign key includes `tenant_id` and is `ON DELETE RESTRICT`
  ([ADR 0016](0016-modular-suite-and-shared-warehouse.md) publishes
  `app.membership`; this ADR adds `app.team` and `app.break_glass` to the
  keys a module may reference).
- A member's **caseload** is the records with an `assigned` row naming them
  or a team they belong to. Assigning a case to a team puts it in every
  team member's caseload.
- How a module allocates (who may assign, what an unallocated queue looks
  like) is the module's design. In `cases`, managers allocate under
  `reachable` and caseworkers work under `caseload`.

### Scope rules

The closed list in `packages/domain/src/platform/access.ts` gains two rules,
both owned by the platform, both console only:

- **`reachable`:** a record in the tenant that is not restricted, or is
  restricted and the caller has an `assigned` or `named` access row for it,
  directly or through a team. On the record's own read routes only, an
  unexpired break-glass grant counts too (see "Break-glass reach is read
  only").
- **`caseload`:** a record in the caller's caseload, and, if restricted,
  one they reach. Every `assigned` row is also reach, so a caseload record
  is always reachable. Break-glass never puts a record in a caseload.

- A route contract on a restrictable record names it: `record: 'cases.case'`.
  A route test refuses `tenant` on a restrictable record, and `reachable` or
  `caseload` without one.
- A route still names one scope rule. A manager's routes and a caseworker's
  routes for the same record are separate routes under separate
  permissions, as reviewers' routes already are.
- The module registers, for each restrictable record, a descriptor (its
  table, its access table, the route parameter holding the id) and its
  resolvers, which it builds with the platform helper below. The module's
  own code runs every query on its tables. The API refuses to start with a
  route whose rule and record have no resolver.
- `tenant` is unchanged for every record that is not restrictable.

### The shared list filter

This is the centre of the decision. One platform helper in the policy
module, given the caller, the record's descriptor and whether break-glass
counts (`withBreakGlass`), returns the reach condition for a query on that
record's table. Detail resolvers and lists are built from it:

- A detail resolver is the list condition plus `id = <the route's id>`. A
  record a list shows is therefore one its detail route answers, and one the
  detail route answers 404 for cannot appear in the list.
- Every list, search, count and export on a `reachable` or `caseload` route
  adds the condition to its query. Counts, totals and page numbers come from
  the same filtered query, never from a count over the whole table.
- Break-glass reach opens the record's own pages only. Lists, search and
  exports are built with `withBreakGlass` false, so an emergency grant
  cannot be turned into a bulk read.
- Search ([ADR 0025](0025-party-matching-merge-and-search.md)) runs each
  module's provider with the condition, so a hit never names a record its
  detail route would refuse. A restricted record never appears in the
  tenant-wide search of anyone not named on it.
- An export a user asks for runs as a job request (ADR 0009). The job
  applies the condition for the requester as they are when it runs, and the
  database applies their reach too (below).
- **Proof.** A route test walks every route on `reachable` or `caseload`.
  For each, it seeds a record the caller reaches, one in the tenant outside
  their caseload, and one restricted without them. Detail routes must answer
  the first and give 404 for the others as the rule says; list, search,
  count and export routes must return exactly what the detail routes
  answer. The helper records its use on the request in tests, and the test
  fails if a list route's handler returns without calling it.
- Probing is closed too. A write that names a record, including creating a
  child of it, goes through the resolver first, so an id the caller cannot
  reach answers 404 before any insert. This is what closes the foreign key
  oracle for the API: a foreign key check ignores row-level security, so
  without the resolver a database error could tell a hidden record from a
  missing id (see the policies below). The route test covers every child
  create route. A restrictable table has no unique constraint on a value a
  member chooses, so a conflict cannot reveal a hidden record. Problem
  details stay as ADR 0004 sets them.

### Restricting a record

- A record is restricted by setting `restricted`, and only the members and
  teams with an access row reach it, whatever permission others hold.
- Each module that has restrictable records adds a permission
  `<module>.records.restrict` (step-up for changes), used on `reachable`
  routes. A holder may restrict or lift a record they reach without
  break-glass, and add and remove its `named` rows.
- Restricting and lifting take a reason code from a checked list (in v1
  `safeguarding`, `legal`, `about_a_colleague`, `conflict_of_interest` and
  `other`). Each restrict, lift, name and unname writes an audit event,
  such as `cases.case.restricted`, `.unrestricted`, `.access_granted` and
  `.access_removed`, holding ids, codes and the before and after of the
  flag. A restriction is the state of one record, not tenant configuration,
  so it writes no `config_version`.
- Nobody can restrict a record away from themselves: the database refuses
  an update that leaves a restricted record the actor cannot reach (below).
  Restricting therefore names the actor first, and the API refuses removing
  the last access row of a restricted record. The restrict screen lists the
  access rows already on the record, and the audit event records them, so
  rows added while it was unrestricted are seen when it is restricted.
- A record type that must be restricted from creation, such as a
  safeguarding concern, is created, named and restricted in one transaction,
  and a deferred constraint trigger refuses a commit that leaves one
  unrestricted. Nobody else sees it before it commits.
- **Orphaned records.** A restricted record is orphaned when no access row
  names a membership that is `active` or `suspended`, or a team not archived
  that has such a member. Break-glass can read it but cannot name anyone
  (below), so it is handed on: a member holding
  `platform.break_glass.review`, with step-up and a reason code and text,
  names one member other than themselves. The route calls the module's
  approved definer function, such as `cases.hand_on_case(case_id,
  membership_id)`, which checks in the database that the record is
  restricted and orphaned, that the membership named is active and is not
  `app.current_membership_id()`, and then inserts one `named` row. In the
  same transaction it alerts every reviewer, every tenant admin and the
  member named, and writes `cases.case.handed_on`. Removing a membership or
  archiving a team that leaves a restricted record orphaned is allowed,
  since access must be removable at once, but alerts the reviewers, and
  their review screen lists orphaned records.

### Break-glass reach is read only

Decided: break-glass reach lets the member read the record's own pages
(its detail routes, and its children's detail and list routes inside that
record) and nothing else. It allows no write. Editing the record, creating,
changing or deleting its children, restricting, lifting, naming,
unnaming and allocating all need reach without break-glass. A grant is for
seeing what is happening in an emergency; acting on the record is for the
people named on it, whom the grant holder can now contact, or for a
reviewer handing on an orphaned record.

- **API.** Read routes on a restrictable record use a resolver built with
  `withBreakGlass` true. Every other route, including every route under
  `<module>.records.restrict` and every allocation route, uses a resolver
  built with it false, and so does every list, search, count and export
  across records. The route test fails for a write route whose resolver
  counts break-glass.
- **Database.** The restrictive policies count break-glass for `SELECT`
  only. `INSERT`, `UPDATE` and `DELETE` call the reach functions with
  `with_break_glass` false. The only writes outside them are the module's
  open function, which writes a `break_glass` access row, and its hand-on
  function, each running as its own owner. So a grant holder cannot name
  themselves, remove the named people, allocate the record or lift the
  restriction, even through a forgotten resolver, and their reach ends when
  the hour does.

### Row-level security as a second line

Restriction is also enforced by the database. A forgotten filter, a
module bug or an injected query cannot write a restricted record, its
children or its access rows, cannot create a record already restricted,
and cannot read any of them without being named on the record or holding
a grant. A grant exists only through the module's open function, which
checks the member, the role, the step-up, the record and the reviewers,
and writes the audit event and the alert in the same transaction
("Break-glass"). So, short of tampering with the setting itself (see
"Threats"), an injected query can open a grant only for the member whose
request it runs in, only when that member could open one in the console,
and never without the alert and the audit event. Caseloads are not
enforced by the database: they depend on the route's rule, which the
database cannot know.

**The setting.**

- `app.current_membership_id()`, `STABLE`, returns
  `NULLIF(current_setting('app.membership_id', true), '')::uuid`, as
  `app.current_tenant_id()` does for the tenant.
- `withTenant()` is the only place that sets it, transaction-locally, after
  the tenant. It takes an optional member source of a branded type that,
  like `TenantId`, only trusted code can make:
  1. the verified session's user, from the session lookup in
     `apps/api/src/auth`;
  2. a `job_request` row, in the job wrapper of ADR 0009, for a job a user
     asked for.

  Inside the transaction it reads that user's or that requester's
  membership in the tenant, under row-level security, and sets the setting
  only if the membership is `active`. A request body, URL or job payload
  never supplies a membership id.
- `withTenant()` refuses a connection where the setting is already set, as
  it does for the tenant, and its `DISCARD ALL` clears both. The policy
  module takes the membership `withTenant()` resolved rather than querying
  it again, so the two cannot differ.
- A Semgrep rule bans naming `app.membership_id` outside
  `packages/db/src/tenant-context.ts` and the migrations.

**No membership, no restricted rows.** A transaction with no setting
reaches no restricted record: scheduled and event jobs, release emails,
operator commands, public routes, auth and anything else. The approved
exceptions are:

- a job request, which sees what its requester reaches when the job runs;
- a module's approved definer function in ADR 0003's catalogue, with its
  own `NOLOGIN` owner (ADR 0023): the module's erasure contribution
  (ADR 0027), its subject data contribution, which returns only the type
  and id of a restricted record, never its content ("Subject access and
  erasure", below), its retention deletes, its break-glass open function,
  which reads only the record's `restricted` flag and subject party, its
  hand-on function, and any
  event handler that must act on a restricted record. Each catalogue entry
  says whether the function reads restricted rows and why;
- data steps under [ADR 0029](0029-tenant-by-tenant-data-migrations.md),
  run as `migrator_data`, which change how data is held and read none out.

No public definer function
([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md),
[ADR 0036](0036-anonymous-public-submissions.md)) may hold a grant on a
restrictable table, and the catalogue test checks it.

**The policies.**

- Each restrictable record has two approved definer functions in its
  module, such as:
  - `cases.case_named(case_id uuid, with_break_glass boolean)`: an access
    row names the current membership or one of its teams not archived,
    counting `break_glass` rows only when asked and only while their grant
    is unexpired;
  - `cases.reaches_case(case_id uuid, with_break_glass boolean)`: the case
    is not restricted, or `case_named`.

  Their owner has `SELECT` on the columns they read in the record, its
  access table, `app.team`, `app.team_member` and `app.break_glass`, with
  tenant policies `TO` it, and they are callable by `app_api`, `app_worker`
  and `app_operator`. Reading as their owner avoids the recursion a policy
  on the record and a policy on its access table would otherwise cause.
- The record table, its access table and every table holding the record's
  children carry restrictive policies (`AS RESTRICTIVE`) to `app_api`,
  `app_worker` and `app_operator`, one for each of `SELECT`, `INSERT`,
  `UPDATE` (`USING` and `WITH CHECK`) and `DELETE`. Only `SELECT` counts
  break-glass:

  | Table | `SELECT` | `INSERT`, `UPDATE`, `DELETE` |
  | --- | --- | --- |
  | `cases.case` | `NOT restricted OR cases.case_named(id, true)` | Insert: `NOT restricted`. Update and delete: `NOT restricted OR cases.case_named(id, false)` |
  | `cases.case_access` | `cases.reaches_case(case_id, true)` | `kind <> 'break_glass' AND cases.reaches_case(case_id, false)` |
  | Each child table | `cases.reaches_case(case_id, true)` | `cases.reaches_case(case_id, false)` |

- On the record table the terms read the row's own column. An update's
  `USING` judges the old value and its `WITH CHECK` the new one, so
  restricting (the new row is restricted) and lifting (the old row is) both
  need the actor named without break-glass. A record is inserted
  unrestricted, as a database rule; a record that must be restricted from
  creation is restricted by an update in the same transaction.
- On an unrestricted record `reaches_case(case_id, false)` is true for
  anyone in the tenant, so allocation and naming there rest on the API's
  permission check, as every other tenant-wide write does. On a restricted
  record it is `case_named(case_id, false)`.
- No app role writes a `break_glass` access row. The module's open function
  writes it, as its owner, and nothing changes or deletes it; it stays as
  history and stops counting when the grant expires.
- A foreign key check ignores row-level security, so without an `INSERT`
  policy a child insert succeeds against a hidden record and fails the
  foreign key against a missing id, which tells the two apart. The
  restrictive `INSERT` check runs before the foreign key check, and
  `reaches_case` is false (never true) for an id it cannot see, so a
  missing id and a hidden one now fail the same policy with the same
  error. That holds only while every child table's policy calls the reach
  function on the parent id; "resolver first" (above) is what closes the
  oracle for the API, and the route test covers every child create route.
- Owners of other definer functions and `migrator_data` are not named in
  the restrictive policies; the catalogue test knows each one.
- A helper, `app.enable_reach_rls()`, adds the four policies to a table,
  and the catalogue test fails for a table with a `restricted` column, or a
  foreign key to a restrictable record, that lacks a restrictive policy for
  any one of `SELECT`, `INSERT`, `UPDATE` and `DELETE`.
- S12-70's database tests, as a member in the same tenant: one not named
  cannot read, insert a child into, update or delete a restricted record or
  its children, nor add, change or remove its access rows; a child insert
  against a hidden record and one against a missing id fail with the same
  error; nobody can insert a record already restricted; and a member
  holding an unexpired grant can read the record and its children but
  cannot insert a `named` or `assigned` row, delete or change any access
  row, lift the restriction, or insert, update or delete a child. For
  grants: a direct insert of an `app.break_glass` row, or of a
  `break_glass` access row, as `app_api` is refused; `app_api` cannot call
  `app.open_break_glass` itself; the module's open function refuses with
  no membership set, without the role or a recent step-up, without
  another reviewer, and for a record that does not exist or is not
  restricted, leaving nothing; a grant it opens has its audit event and
  one alert row per recipient in the same transaction; and a `break_glass`
  access row whose `case_id` differs from its grant's `record_id` fails
  the foreign key.
- Cost: one indexed lookup per restricted row read, and per child row.
  Restricted records are few, and child lists belong to one record.

What each path sees:

| Path | Membership set | Restricted records |
| --- | --- | --- |
| Console or portal request | The session's | Those it reaches |
| Job a user asked for | The requester's, if still active | Those the requester reaches now, without break-glass in exports |
| Scheduled job, event handler, release email | None | None, except through an approved module function |
| Erasure, retention | None | Through the module's approved functions only, with an alert for erasure |
| Subject access | None, then the releasing member's | Type and id only; content only through a member who reaches the record |
| Operator command | None | None |
| Data step | None | Rewritten as `migrator_data`, never read out |
| Public route | No tenant | None |
| Warehouse snapshot and `insight` totals | The admin's | None: they leave restricted records out |

The warehouse and `insight` totals leave restricted records and their
children out for everyone. A snapshot is loaded into tools outside this
model, where every reader would see it.

### Break-glass

A member may open a restricted record they do not reach, in an emergency,
only like this:

- **Permission.** `platform.break_glass.use` (console, step-up). No seeded
  role has it except a new role, "Safeguarding lead". `tenant_admin` does
  not, so an admin who needs it takes that role through the normal role
  change, which is step-up and audited.
- **Route.** `POST /console/break-glass`, `tenant` scope, with the record
  type (a closed list built from the modules' restrictable records), the
  record id, a reason code and a reason text. The record's module must be
  on ([ADR 0024](0024-no-tool-on-by-default.md)).
- **Reason.** A code from a checked list (in v1 `risk_to_life`,
  `safeguarding_concern`, `legal_duty`, `named_people_unavailable` and
  `other`) and a text of 20 to 1,000 characters. The form asks for why the
  access is needed, without naming anyone.
- **Step-up** within 5 minutes (ADR 0010), on every grant.
- **Only through the database's open function.** App roles have `SELECT`
  on `app.break_glass` and no `INSERT`, and no app role may write a
  `break_glass` access row (above). The handler checks the permission and
  this session's step-up, encrypts the reason text, then calls the
  module's approved definer function, such as
  `cases.open_break_glass(case_id, grant_id, request_id, reason_code,
  reason_text_ciphertext)`, executable by `app_api` alone. As its own
  owner it reads the case, and returns nothing, writing nothing, if the
  case does not exist or is not restricted. Otherwise it calls the
  platform's `app.open_break_glass(...)` with `'cases.case'`, the case id
  and its subject party, then writes the `break_glass` access row for that
  case and the grant, and queues the alerts to the members named directly
  on the case. `app.open_break_glass` is executable only by the owners of
  the modules' open functions, never by an app role. In the same
  transaction it:
  - takes the member from `app.current_membership_id()` and refuses if it
    is unset or not `active`;
  - refuses unless the member holds a role that includes
    `platform.break_glass.use`, and their account has an unrevoked console
    session re-authenticated in the last 5 minutes. The role lists are
    copied from `roles.ts`, as the checks on roles already are, and a test
    keeps them in step. The API's check of this session's step-up stays
    the stricter one; the database's holds the line against a query that
    bypasses the handler;
  - refuses unless another active member holds a role that includes
    `platform.break_glass.review`;
  - inserts the grant, writes `platform.break_glass.opened`, queues the
    alerts to the reviewers (below) and returns the grant's id.

  The grant id comes from the API so the reason text can be encrypted with
  it as associated data; a duplicate fails the primary key. Each function
  has its own `NOLOGIN` owner (ADR 0023) with only the grants it needs: the
  module's owner reads the record's id, `restricted` flag and subject
  party, reads its access table, and inserts into its access table and
  `app.access_alert`; the platform's owner reads
  `app.membership` and, by column, `auth.session`, and inserts into
  `app.break_glass`, `app.audit_event` and `app.access_alert`.
- **The grant.** `app.break_glass` holds `membership_id`, `record_type`
  (checked against the pattern of record types), `record_id`,
  `reason_code`, `reason_text_ciphertext`, `granted_at`, `expires_at` and
  `retain_until`, unique on
  `(tenant_id, id, membership_id, record_type, record_id)` for the access
  row's key. It is append-only, with restrictive `false` policies on
  `UPDATE` and `DELETE` for every app role. A `BEFORE INSERT` trigger sets
  `granted_at` to `now()` and `expires_at` to one hour later, ignoring any
  supplied value. The reach function compares `expires_at` with the
  transaction's `now()`, so a grant cannot be stretched by the API or
  extended by a tenant. There is nothing to close: it ends by itself.
- **One record per grant.** After the open function returns, the handler
  loads the record through its normal reach. A record that does not exist,
  or is not restricted, answers 404 and leaves nothing. The console's
  not-found page offers emergency access to holders of the permission for
  any id, so the offer reveals nothing.
- **Renewal** is a new grant: a new reason, a new step-up and a new alert.
  There is no extension.
- **Audit.** `platform.break_glass.opened`, written by the open function
  on the grant, with the record type and id, the reason code and the
  record's subject party (ADR 0027). Every read during the grant is a
  restricted read (below).
- **No automatic path.** No job, rule, workflow step or connection made
  through `connect` opens a grant: only `app_api` may call the open
  functions, and they need a member with the role and a console session
  re-authenticated in the last 5 minutes. It needs a named member, in the
  spirit of rule 9.

### Alerts and review

- **Alert at once.** The open functions queue the alerts in the grant's
  own transaction, so a grant without its alerts cannot exist: one row in
  `app.access_alert`, the platform's outbox for access alerts following
  ADR 0020's pattern, for every active member holding a role that includes
  `platform.break_glass.review` other than the requester, and for each
  member named directly on the record. The API sends them as ADR 0020's
  sender does. The email is transactional
  ([ADR 0033](0033-consent-and-communications.md)) and holds no name,
  reason text or record content: it says emergency access was used and
  links to the review screen.
- **Someone must be there to read it.** A grant is refused, with a problem
  saying why, unless another active member holds the review permission;
  the API checks first so it can say so, and the open function checks
  again. `platform.break_glass.review` (console, `tenant`) is in
  `tenant_admin` and the "Safeguarding lead" role.
- **Review after.** A reviewer who is not the requester records an outcome,
  `justified` or `not_justified`, in `app.break_glass_review`: append-only,
  one per grant, with `(tenant_id, break_glass_id, requester_membership_id)`
  to `app.break_glass (tenant_id, id, membership_id)` and a check that the
  reviewer is not the requester. The review screen shows the requester, the
  reason, the times and the read events during the grant. Each review is
  audited as `platform.break_glass.reviewed`.
- **Escalation.** A grant unreviewed after 3 days, a member's third grant
  in 24 hours, and a `not_justified` outcome each alert every tenant admin
  as well.
- **Other ways in alert too.** Adding a member to a team named on any
  restricted record, and a role change that gives
  `platform.break_glass.use`, send the same alert to the reviewers.

### Reading restricted records

- Every read of a restricted record writes an audit event holding ids and
  codes only (rule 4): the module's sensitive read, such as
  `cases.case.viewed`, with the record's subject party id. A list, search
  or export writes one event per restricted record it returns, with the
  ids, never a search term. This matches the rule that every staff or
  reviewer read of an application is audited.
- Reads during a grant are audited the same way, and the review screen ties
  them to the grant by member and time.
- **Audit events about a restricted record.** An event whose entity is a
  restricted record, one of its children or access rows, a grant on it or
  one of its held-back subject access items carries the record's type and
  id in two new columns of `app.audit_event`, `reach_record_type` and
  `reach_record_id`, set by the writer from the record it loaded (rule 6).
  The audit log route lists such an event only to a reader who reaches
  that record now without break-glass, through the shared filter, and
  never resolves its label otherwise. The break-glass review screen shows
  a reviewer the grant under review and the read events during it, by id,
  never the record's subject. This filter is in the API only: the audit
  table keeps its tenant policy, since the subject access job and the
  review screen read it, and its rows hold ids and codes, never content.
  Reading the audit log is still not itself audited.

### Subject access and erasure

Subject access must be complete, but the requester
(`platform.subject_access.request`, held by `tenant_admin`) is not someone
a restriction trusts, and `tenant_admin` is deliberately kept out of
break-glass. The requester may also be the subject, or ask about anyone.
Decided: restricted content never reaches a subject access output through
a requester who does not reach the record, and the requester cannot tell
whether anything was held back. Held-back records are decided, against the
statutory deadline, by the members who reach them.

- **Held back.** The module's subject data contribution returns each
  restricted record about the subject as its type and id only. If the
  requester reaches the record without break-glass, the job reads it under
  their membership as usual and marks it for exemption review. Otherwise
  the output holds no part of it, nor any audit event that names it
  (above), and the contribution's approved function writes a held-back
  item in the module's own table (in `cases`,
  `cases.case_subject_access_item`), a child of the record with composite
  foreign keys to it and to the job request, holding the request's
  statutory deadline copied from the subject access request. No platform
  table names the record, and the item carries the reach policies like any
  child, so only members who reach the record see or decide it.
- **What the requester sees.** The output finishes, and looks the same,
  whether or not anything was held back: no "waiting on review" state, no
  count of items released or withheld, and no event or status they can
  read that says otherwise. A withheld item leaves nothing the requester
  can see.
- **Who decides.** In the job's transaction, an alert is queued to the
  members named on the record, directly or through a team, giving the
  deadline. Each item needs one outcome from one of them, reaching the
  record without break-glass: `released`, or `withheld` with an exemption
  code from a checked list. An orphaned record is handed on first (above),
  and the reviewers are alerted to do so. An item undecided 5 working days
  before its deadline alerts the reviewers, and again when the deadline
  passes. Reviewers can chase it but not decide it. Tenant admins as such
  are not alerted.
- **Nobody tipped off.** Every alert about a held-back item, to named
  members or reviewers, leaves out the requester and any member whose
  account is the subject (`party.person.user_id`, ADR 0017), and holds
  only the item's id and deadline.
- **Release.** The release form tells the member that the requester will
  see the released content, and that a supplement shows them something was
  held back. A released record's content is read by a job the releasing
  member asks for, under their membership (ADR 0009), and added to the
  requester's output as a supplement. It never passes through the module
  function's no-membership path. Every outcome and release is audited with
  ids and codes only, as an event about the restricted record.
- **Proof.** S12-79's tests run two subject access requests as a tenant
  admin not named on anything, one about a subject with a restricted
  record they do not reach and one about a subject without, and compare
  what the admin can read: the output, the request's status and events,
  the audit log and their alerts must differ only in the subject's own
  ordinary data. The same holds when the admin is the subject. A release
  then adds a supplement; a withhold adds nothing.
- **Erasure.** The erasure contribution acts on restricted records through
  the module's approved functions, as for any record. For each restricted
  record it changes, it queues, in the erasure transaction, an alert to the
  members named on it and to the reviewers, holding no name or content,
  and writes the module's audit event with the record id. Counts returned
  to the engine include restricted records in their table's total, never
  separately.

### Reviewers and blind review

- `assigned_review` and blind review are unchanged. A reviewer still
  reaches only their own assignments without a declared conflict, and gets
  404 for anything else.
- The new rules narrow reach and never widen it. If grants ever makes
  applications restrictable, the restrictive policies sit under
  `assigned_review` as they sit under every rule: an assigned reviewer not
  named on a restricted application gets 404, and naming comes before
  assignment.
- Break-glass gives reach, never a permission or an audience. The response
  contract and the blind projection come from the route and the member's
  permissions, so a grant cannot show a reviewer an applicant's identity
  that their routes would not.

### Threats

S12-54 writes the full threat model from this ADR. The break-glass threats
and what answers each:

- **An insider with a plausible reason.** Not preventable by software.
  Deterred: step-up, a written reason, an alert to others at once, a
  review by someone else that sees every read made, and escalation of
  `not_justified`.
- **Repeated renewal.** Each grant needs its own reason, step-up and alert.
  The third in 24 hours alerts every tenant admin.
- **A stale grant left open.** One hour, set and checked by the database.
  No code path extends it.
- **An alert nobody reads.** No grant without another reviewer; email and a
  review queue; escalation after 3 days.
- **Reaching blind-review identity.** Break-glass adds no permission and
  changes no projection (above).
- **Turning a grant into lasting reach.** A member with
  `platform.break_glass.use` and `<module>.records.restrict` opens a
  safeguarding case for an hour, then names themselves, removes the
  safeguarding lead, allocates the case to themselves or lifts the
  restriction, and keeps reach after the grant expires. Answered by
  read-only break-glass: every one of those writes needs reach without
  break-glass, in the API (resolvers built with `withBreakGlass` false) and
  in the database (write policies call the reach functions with false).
  The one write that follows from an orphaned record, handing it on, is
  made by a reviewer, never names the reviewer, and alerts every reviewer
  and tenant admin. S12-79's tests hold a grant and call every write route
  on the record, including restrict, lift, name, unname and allocate, and
  expect 404 from each, then repeat the writes as direct queries and
  expect the database to refuse them.
- **A grant opened by a direct query.** An injected query, or a stray code
  path on an `app_api` connection, inserts a grant and a `break_glass`
  access row for itself and reads a restricted record with no alert.
  Answered: no app role may insert either; a grant exists only through the
  module's open function, which takes the member from the session's
  setting, checks the role, a recent step-up, the record and another
  reviewer, and writes the audit event and the alerts in the same
  transaction; and the access row's foreign key ties it to the record the
  grant names, so a review screen built from the grant shows the record
  actually read.
- **Subject access as a way round.** A tenant admin starts a subject access
  request for the person a restricted record is about, to read it in the
  output. Answered by holding restricted content back until a member who
  reaches the record releases it ("Subject access and erasure").
- **Subject access as an existence probe.** A tenant admin who suspects a
  safeguarding concern has been raised about them starts a subject access
  request about themselves, and learns from a waiting state, a count, an
  audit event or an alert that a restricted record concerns them, which
  defeats the `about_a_colleague` and `legal` restrictions. Answered: the
  output finishes and looks the same either way; events about a restricted
  record are left out of the output and the audit log for anyone who does
  not reach it; alerts about held-back items leave out the requester and
  the subject; and only a named member's choice to release adds anything.
- **A quieter way in.** Joining a named team, taking the break-glass role or
  handing on an orphaned record alerts the reviewers. Naming oneself needs
  reach without break-glass first.
- **Enumeration.** 404 for every unreachable id, the emergency offer for
  any id, filtered counts, search and audit log, no member-chosen unique
  values, and a subject access output that does not change with what was
  held back.
- **Tampering with the setting.** As with `app.tenant_id`, an injection
  that reaches `set_config` could change it for one transaction. The
  Semgrep rules, the empty-setting check and `DISCARD ALL` limit it to
  that.

### Contracts

S12-03 builds the contracts:

- `access.ts`: `reachable` and `caseload` in `scopeRules`;
  `platform.teams.manage`, `platform.break_glass.use` and
  `platform.break_glass.review`; the route field `record` and its checks.
- `roles.ts`: `platform.teams.manage` and `platform.break_glass.review` in
  `tenant_admin`; the "Safeguarding lead" role. Team membership adds no
  permission.
- `team/` (the existing members area): team routes, each change step-up.
- Break-glass, review and hand-on routes, in the platform contracts.
- The held-back subject access item's outcomes (`released`, `withheld`)
  and exemption codes, which each restrictable module's decide route uses.
- Audit actions for teams, grants, reviews, hand-ons and held-back items,
  and the reason code lists.

Every contracts entry point these touch, and any new area such as
break-glass, imports the jitless zod switch (`packages/domain/src/jitless`)
before anything else, and each new area gets its line in the jitless test.

### Not decided here

- Delegated administration.
- Restricting records an applicant or beneficiary reaches through an `own_`
  rule. A module that needs it adds an own-subject term in its own ADR.
- Making grants records restrictable.
- Approvals on restricted records: ADR 0038, being drafted.
- Webhooks: [ADR 0034](0034-event-outbox.md) already leaves `connect` to
  check the subscriber's permission. `connect` must not deliver an event
  about a restricted record, and a connection gets at most its user's reach,
  without break-glass.

## Consequences

- One model for `governance`, `volunteers` and `cases`. A module adds a
  restrictable record with a column, an access table, one reach function
  pair, a break-glass open function, a hand-on function, a held-back subject
  access table and a descriptor, and inherits lists, search, exports,
  break-glass and alerts.
- Lists can no longer drift from detail routes: the same condition builds
  both, and a route test proves it.
- Every connection path now has a membership rule. The job wrapper passes
  the job request to `withTenant()`; erasure and retention on restrictable
  tables go through module functions, erasure with an alert; subject access
  holds restricted content back for a member who reaches it, without telling
  the requester; the warehouse leaves restricted records out. Each
  restrictable table costs one more catalogue entry and a policy check per
  restricted row.
- Rule 2: every new table (`app.team`, `app.team_member`, `app.break_glass`,
  `app.break_glass_review`, `app.access_alert`, and each module's access and
  held-back subject access tables) is a tenant table with forced row-level
  security and a cross-tenant denial test, plus a test that another member
  in the same tenant cannot reach a restricted record or another team's
  caseload.
- Rule 3: composite foreign keys throughout, no polymorphic reference, and
  checks on kinds and reason codes.
- Rule 4: team changes, restrictions, naming, hand-ons, grants, reviews,
  held-back item outcomes, erasure of restricted records and every
  restricted read write audit events with ids and codes only.
- Rule 5: every new column is classified with a retention rule. Names of
  teams, kinds, codes, flags, ids, deadlines and the audit event's
  `reach_record_type` and `reach_record_id` are internal.
  `reason_text_ciphertext` is personal: the requester's own words, encrypted
  under the requester's subject key with ADR 0027's envelope (row id and
  field id as associated data), so erasure shreds it without updating the
  row. Grants, reviews and access alerts are kept as long as the audit
  trail: the database sets `retain_until` from the tenant's audit rule, and
  ADR 0003's purge removes them with the events. Teams and team members are
  kept until removed.
- Rule 6: the acting member, the requester and the reviewer always come from
  the session, and the membership setting only from `withTenant()`. The open
  function takes the grant's member from that setting, never from an
  argument.
- Rule 10: team definitions are versioned; per-record restriction and team
  membership are audited access changes.
- Amendments, with status lines in a later housekeeping change: ADR 0003
  gains the membership setting, its function, the restrictive reach
  policies, the break-glass open functions, the audit event's reach columns
  and three more tables for the purge; ADR 0004's list of scope rules and
  its "lists filter in the handler" give way to the shared filter; ADR
  0009's job wrapper passes the job request to `withTenant()`; ADR 0016's
  published keys gain `app.team` and `app.break_glass`; ADR 0027's subject
  data contribution returns only the type and id of a restricted record the
  requester does not reach, the output leaves out audit events about such a
  record and never shows that anything was held back, and its erasure
  contribution alerts on restricted records; ADR 0028's note that the tenant
  context holds no membership is out of date, though its key scoping is
  unchanged.
- Build order: contracts (S12-03), schema and tenant context (S12-70),
  resolvers, list filter and break-glass flow (S12-79), screens (S12-87),
  end-to-end tests (S12-93) and the threat model (S12-54).

## Dependency check

No dependency is added.
