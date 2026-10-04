# ADR 0024: No tool on by default

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0016](0016-modular-suite-and-shared-warehouse.md) lets a tenant switch
modules on and off through `app.tenant_module`, and its module table lists
grants as "Switchable, on by default". MVP1 shipped that rule: a switchable
module with no row for a tenant is on, and only a row with `enabled` false
turns it off. With grants the only switchable module, that was the simplest
way to get one funding round working.

The suite now adds more tools, and each must work on its own: the platform
and `party` are always on, every other tool is chosen per tenant, and one
tool's features use another tool's data only when that tool is on. Under "no
row means on", registering a new module would switch it on for every
existing tenant the moment it deploys, exposing routes, screens and event
handlers that no one chose. Off is the safe state for all three.

Constraints:

- Every tenant table has forced row-level security, which applies to the
  migrator too, and no role has `BYPASSRLS`
  ([ADR 0003](0003-query-builder-and-migrations.md)). A migration cannot
  read or write tenant rows without setting each tenant in turn.
- `app.tenant_module` allows one row per tenant and module, admits only
  switchable modules in its `module` check, and denies `DELETE` to the app
  roles. Switching off sets `enabled` to false.
- `app.tenant_module.updated_by` and `app.config_version.author_id` are
  `NOT NULL` foreign keys to `app.membership`, so today only a member can
  author a switch.
- Every job handler in the worker connects as `app_worker` (ADR 0003), so a
  right given to `app_worker` is given to every handler, not only to the
  operator commands that share its credentials.
- Every switch is a configuration change (rule 10) and a state change that
  is audited (rule 4).
- Tenants that exist when this ships use grants today and must keep it.

## Options considered

1. **Keep "no row means on".** Nothing changes for existing tenants, but
   every newly registered module appears for every tenant at once, and
   keeping it off would mean writing an "off" row for every tenant before
   each module's first deploy.
2. **No tool on by default.** A switchable module is on only where an
   explicit row says so. A new module is off everywhere until someone
   switches it on, and a tenant's tools are exactly the rows it has. Tenant
   creation must name its tools, and existing tenants need a backfill to
   keep grants.
3. **A per-deployment default list.** The operator configures which modules
   count as on without a row. Read at request time, adding a module to the
   list switches it on for every tenant at once, as in option 1; read only
   at tenant creation, it is option 2 with a configuration file. Either way
   the effective state lives partly outside the tenant's versioned
   configuration, and cells could behave differently with the same data.

## Decision

Option 2. This amends ADR 0016's "Switching modules on and off" section, and
the grants row of its module table, whose "Per tenant" entry becomes
"Switchable".

### Which tools are on

- The platform and `party` are always on and have no row.
- Every switchable module, grants and every later module, is on for a
  tenant only when that tenant's `app.tenant_module` row for it has
  `enabled` true. No row, or a row with `enabled` false, means off.
- The same rule applies to everything the tenant's users and handlers
  reach: the API policy, the console and portal shells and their
  navigation, the settings module list, event handlers, and any feature of
  one tool that uses another tool's data, which does so only when that tool
  is on.

### When a module is off

Unchanged from ADR 0016:

- Its routes answer 404, not 403, so the module's existence is not revealed
  ([ADR 0004](0004-api-contract.md)).
- Its screens and navigation are hidden.
- Its event handlers skip the tenant.
- Its data is kept and returns when the module is switched on again. Only
  retention rules and erasure
  ([ADR 0027](0027-erasure-across-modules-and-audit.md)) remove or anonymise
  it. Switching off never deletes or rewrites rows.

The off rule does not reach data protection and integrity operations. They
always include a switched-off module's data, because the tenant still holds
it and it is still about people:

- erasure, which runs every module's contribution whatever its switch
  (ADR 0027);
- subject access and data export, through each module's subject data
  contribution (ADR 0027);
- party merge, which re-points a switched-off module's rows to the surviving
  party ([ADR 0025](0025-party-matching-merge-and-search.md));
- retention rules and the audit retention purge (ADR 0003).

A switched-off module also still feeds the warehouse (ADR 0016). The
warehouse is the tenant's whole record, its reports on past years must not
change when a tool is switched off, and a download already runs under a
tenant admin's permission and the classification filter.

### Creating a tenant

- `pnpm tenant:create` takes the list of tools to switch on. The domain
  package refuses an unknown, repeated or non-switchable id, such as
  `party`, before the command connects. An empty list is valid: the tenant
  has the platform and `party` only.
- `app.create_tenant(slug, name)` is unchanged
  ([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md)). In the
  same transaction, the command sets the new tenant through ADR 0019's
  operator helper and writes one `app.tenant_module` row for every
  switchable module: `enabled` true for each listed tool and false for the
  rest. The database checks the list again (rule 6): the `module` check
  refuses an unknown or non-switchable id, and the unique key on tenant and
  module refuses a repeated one. A refused list writes nothing, not even
  the tenant.
- So every tenant created after this change has a grants row, on or off,
  and a missing grants row can only mean a tenant from before it.
- The development and staging seed writes the same rows: grants on for
  every tenant that runs a funding round, and every other module off.

### Recording each switch

- Each switch, whether by a tenant admin, at tenant creation or by the
  backfill below, writes a `config_version` row with author and diff
  (rule 10) and an `audit_event` (rule 4), in the same transaction as the
  change. Each row written at tenant creation counts as a switch.
- A tenant admin's switch names their membership. Tenant creation and the
  backfill have no membership to name, so they record the author kind
  `operator` and never borrow a member's identity.

### Operator writes

- **Tenant source.** ADR 0003's list of tenant sources gains a seventh
  (ADR 0019 added the sixth): in the module backfill command only, a tenant
  that `app.tenant_ids()` returned, set as `app_worker` through ADR 0019's
  operator helper. ADR 0003's limit of the fan-out to the scheduler's
  platform job, and ADR 0019's limit of the helper to the id
  `app.create_tenant()` returned, each widen to this one command. The
  Semgrep rules that enforce those limits admit the command's file and
  nothing else.
- **No new definer rights.** The owner of `app.create_tenant()` keeps
  exactly the grants ADR 0019 lists. Module rows, configuration versions
  and their audit events are written with the tenant set, under the normal
  tenant policies, so neither command can write another tenant's rows.
- **Operator role.** Those writes must not be open to job handlers, so
  they belong to a new `NOLOGIN` role, `app_operator`, not to `app_worker`.
  It has the attributes of ADR 0003's roles, owns nothing and holds exactly
  the grants below. It joins the role list of ADR 0003's row-level security
  rule 4, so every restrictive false policy names it with the other four app
  roles. A denied command, such as `UPDATE` on `app.audit_event` or
  `DELETE` on `app.tenant_module`, then stays denied to it even if a later
  migration grants too much. `app_worker` is a member of it
  `WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`, the pattern of
  [ADR 0023](0023-function-owner-memberships.md): a worker connection holds
  none of its grants until it runs `SET LOCAL ROLE app_operator`, which
  ends with the transaction. After setting the tenant, the two operator
  commands switch role through a helper in `packages/db/src` that only
  `apps/api/src/operator/` may import, write the switch rows, their
  configuration versions and audit events, and switch back.
- **Grants.** `app_operator` holds `USAGE` on schema `app`, `EXECUTE` on
  `app.current_tenant_id()`, and:
  - on `app.tenant_module`, `SELECT` on `id`, `tenant_id` and `module`, and
    `INSERT` on `tenant_id`, `module`, `enabled` and `updated_by_kind`. The
    `id` lets the insert return the new row's id, which its configuration
    version and audit event name as their entity;
  - on `app.config_version`, `INSERT` on `tenant_id`, `entity_type`,
    `entity_id`, `version`, `author_kind` and `diff`;
  - on `app.audit_event`, `INSERT` on `tenant_id`, `request_id`,
    `actor_kind`, `action`, `entity_type`, `entity_id` and `changes`;
  - on `app.retention_policy`, `SELECT` on the columns the audit retention
    trigger reads.

  It gets no `UPDATE`: the operator never changes an existing switch. It
  never gets `updated_by`, `author_id` or `actor_id`, the columns that name
  a membership, so it cannot attribute a row to a member. PostgreSQL checks
  the privilege on every column an `INSERT` names, even for a null value,
  so the audit insert in `packages/db/src/audit.ts` leaves `actor_id` out of
  its column list for a `system` or `operator` actor, and the operator
  commands leave `updated_by` and `author_id` out of theirs. A `user` event
  from `app_operator` is then refused for want of the `actor_id` privilege,
  and the actor check refuses it without a membership in any case.
  `app_worker` gains only `SELECT` on `app.tenant_module`, which event
  handlers need to skip a tenant that has a module off. So a job handler's
  connection can neither insert a switch nor write a configuration version.

- **Static guard.** A Semgrep rule bans, everywhere except
  `apps/api/src/operator/`, the role helper in `packages/db/src` and the
  database tests: naming `app_operator`, importing the role helper, and
  writing `operator` to `updated_by_kind`, `author_kind` or `actor_kind`.
  The last matters for audit events: `app_worker` already writes them, with
  an actor kind, for ADR 0019's tenant creation, so the database alone does
  not stop a handler from attributing an event to the operator.

- **Operator author.** Both tables take the actor shape of
  `app.audit_event`:

  ```sql
  -- app.tenant_module
  updated_by_kind text NOT NULL DEFAULT 'user'
    CHECK (updated_by_kind IN ('user', 'operator')),
  CHECK ((updated_by_kind = 'user') = (updated_by IS NOT NULL))

  -- app.config_version
  author_kind text NOT NULL DEFAULT 'user'
    CHECK (author_kind IN ('user', 'operator')),
  CHECK ((author_kind = 'user') = (author_id IS NOT NULL))
  ```

  - `updated_by` and `author_id` become nullable. Their composite foreign
    keys to `app.membership` stay, so a user author is always a membership
    of the same tenant.
  - `app_api` has no grant on either kind column, `app_operator` none on
    `updated_by` or `author_id`, and `app_worker` no `INSERT` on either
    table. So `app_api` writes only user rows that name a membership, and
    only `app_operator` writes operator rows.
  - Only `app_api` updates a switch, always for a user, so a `BEFORE UPDATE`
    trigger on `app.tenant_module` sets `updated_by_kind` to `user`, and the
    check then requires the membership.
  - The default keeps existing rows as they are. Both kind columns are
    classified as internal, with their row's retention (rule 5).

### Existing tenants

- Grants stays on for every tenant that exists when this change ships,
  through an operator backfill (S11-69). It lists tenants through
  `app.tenant_ids()`, sets each tenant in turn as above, and inserts an
  enabled grants row only where the tenant has no grants row. An explicit
  off stays off. It is idempotent and prints counts only.
- It can reach only tenants from before the change. Every later tenant has
  a grants row from its creation, and `app.tenant_module` denies `DELETE`,
  so running the backfill again never switches grants on for a tenant that
  did not choose it.
- It runs at deploy, before the policy change takes effect, and again when
  a suspended tenant is reactivated, since `app.tenant_ids()` returns active
  tenants only.
- A migration does not do this. Forced row-level security keeps the
  migrator out of tenant rows, no role has `BYPASSRLS` or will be given it,
  and the tenant-by-tenant helper for data migrations
  ([ADR 0029](0029-tenant-by-tenant-data-migrations.md)) is not built until
  a migration needs it. A migration also has no operator to name in the
  audit events the switch requires.

## Consequences

- Registering a module changes nothing for any tenant until someone switches
  it on, so wave 1 modules can deploy before any tenant uses them.
- A module's contracts and permissions may exist for a tenant that has it
  off. Role bundles still list its permissions and other modules can still
  import its contracts, but no route of it answers and no handler runs for
  that tenant.
- Erasure, subject access, export, party merge, retention and the warehouse
  read every registered module whatever its switch, so switching a tool off
  never hides a person's data from them.
- The deploy order is fixed: migrate, run the backfill, then roll out the
  API with the new policy. The other way round, every existing tenant loses
  grants until the backfill runs. S11-69 and the release runbook follow this
  order.
- A tenant suspended when the backfill first runs gets its grants row when
  the command is run again at its reactivation, before its users sign in.
- Operators must name a tenant's tools when creating it. A tenant created
  without any has only the platform and `party` until an admin switches a
  tool on.
- Switches are kept from job handlers by the database, not only by review
  or a static rule. A Semgrep rule alone could not draw that line: API
  routes write the same tables for tenant admins, and services are shared
  between the API and the worker. The role guards against mistakes in
  code, not a compromised worker, which holds the membership; ADR 0003's
  bans on raw SQL keep an injection from reaching `SET ROLE`.
- When accepted, this amends ADR 0003 (a seventh tenant source, the fan-out
  used outside the scheduler, the `app_operator` role, and the restrictive
  policies of row-level security rule 4 naming `app_operator`), ADR 0019 (a
  second input to the operator helper) and ADR 0023 (`app_worker`'s
  membership is the second any role holds, and the roles script and its
  start-up check allow it with exactly those options). All three stay
  untouched until then.
- Follow-on work, not built here:
  - S11-59: the `module` check widened for the wave 1 modules, the author
    kinds, trigger, grants and classification above, and the seed writing a
    row per module, with a database test that `app_worker`, with a tenant
    set, cannot insert a switch or a configuration version, that
    `app_operator` can for that tenant only, and that `app_operator`
    inserting an audit event with actor kind `user` and a membership id is
    refused;
  - in S11-59 too, a migration that changes `app.deny_command()` to name
    `app_operator` with the other four roles and alters every existing
    `deny_*` policy to the same five roles, and the audit insert leaving
    `actor_id` out for non-user actors. The schema lint's list of app roles
    gains `app_operator`, so the catalogue test fails any restrictive false
    policy that does not name all five, with a fixture naming only four;
  - the roles script's next version, creating `app_operator` and
    `app_worker`'s membership, with the start-up check and the catalogue
    test holding the role to the grants above (lead, with S11-59);
  - S11-69: the policy and settings list treating a missing row as off, the
    module list on `pnpm tenant:create` writing a row per switchable module,
    the role helper, the backfill command, and the Semgrep rule changes
    with fixtures showing a job handler that switches role or writes an
    `operator` author or actor is refused, with a test that a second
    backfill run leaves grants off for a tenant created after the change
    with grants off or with no tools;
  - S11-82: an end-to-end suite showing module-off behaviour for each tool.
- Nothing becomes feature-gated: a switch exists because funders work
  differently, and every deployment ships and migrates every module.

## Dependency check

No dependency is added.
