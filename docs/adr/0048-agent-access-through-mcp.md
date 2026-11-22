# ADR 0048: Agent access through MCP

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Aaron Gardner

## Context

Funders are starting to use AI agents: programs, run by the funder or by a
provider the funder chooses, that read data, call tools and draft work for
a person. A funder's staff will want their agent to find applications,
summarise reports or draft a letter in Fairfold. The Model Context Protocol
(MCP) is the open protocol most such agents use to reach a service's tools
(GK). Aaron set the direction on 6 October 2026: MCP for agents, with
fine-grained control.

An agent is one more client outside our process, like a plugin under
[ADR 0044](0044-plugin-api-v1.md). It is held to stricter rules, because a
person delegates to it, its instructions can come from text it reads, and
whatever it reads leaves the cell for wherever the agent runs. This ADR
sets those rules. Nothing is built before wave 2: `connect` builds the MCP
server in Q1 2027, and it launches in June 2027.
[V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1) keeps integrations out of V1.

What this builds on:

- **Reach.** [ADR 0037](0037-record-level-permissions.md): permissions say
  what a member may do, and reach says to which records; restricted
  records, caseloads and break-glass, which opens one record's own pages
  only and never a list or export.
- **Tools that are off.** [ADR 0024](0024-no-tool-on-by-default.md): no
  tool is on for a tenant until it is switched on, and a tool that is off
  answers 404.
- **Contracts.** [ADR 0016](0016-modular-suite-and-shared-warehouse.md):
  modules talk only through published contracts.
  [ADR 0004](0004-api-contract.md): every route has a permission and a
  scope rule, and responses are built through the audience projection,
  including blind review.
- **Sign-in and sessions.** [ADR 0007](0007-authentication.md) and
  [ADR 0010](0010-authentication-security-rules.md): staff sign in with
  MFA; step-up within 5 minutes for sensitive actions; sessions revoked on
  a password reset, an MFA change, deactivation or a membership change;
  outbound calls only through the dispatcher.
- **Approvals.** [ADR 0038](0038-workflow-and-approvals.md): every
  approval decision needs a named member with step-up.
- **Equality data.** [ADR 0032](0032-equality-and-monitoring-data.md):
  monitoring data is aggregate-only and leaves only as suppressed tables.
- **Classification.** Every column has a sensitivity level (`public`,
  `internal`, `personal` or `special_category`) in the classification map
  (rule 5).

The MCP specification and OAuth 2.1 are general knowledge (GK) here, and
the wave 2 task confirms both at the versions current when it starts.

## Options considered

1. **No agent access.** Funders copy data into their agent by hand or by
   export, with no limits, scopes or audit.
2. **Agents use the plugin API with a client of their own** (ADR 0044). A
   client is not a person: an agent would act with a service identity, and
   nobody would answer for what it does.
3. **An MCP server whose connections are delegated by a named user,**
   under six controls, with tools that wrap the published contracts.
4. **An MCP server with its own queries,** tuned for agents. A second path
   to the database, with its own permission checks to get wrong.

## Decision

Option 3. The six controls below are numbered in the order the roadmap set
them, so `connect`'s wave 2 tasks can test against them one by one.

### The server

- The MCP server is part of `connect`. It serves MCP's HTTP transport on a
  host of its own in each cell, where the proxy strips cookies, as on the
  embed host ([ADR 0035](0035-embeds-and-custom-domains.md)), so a console
  session can never be used through it.
- Each tool is a thin wrapper over one or a few published contract routes
  (ADR 0004, ADR 0016). The server calls those routes through the API's own
  route handling, so the policy module, row-level security, the audience
  projection and audit apply exactly as for a person's request. It holds no
  queries of its own and no database role of its own: there is no second
  path to the database.
- The agent is out of our process, wherever the funder runs it. No AI
  provider is named or required: any agent that speaks MCP can connect,
  including one on a model the funder hosts.
- Only console members connect in v1: staff and reviewers. Applicants'
  agents wait for a later amendment.

### Control 1: off by default

- Agent access is off for every tenant until a tenant administrator turns
  it on, with step-up, and `connect` must itself be on (ADR 0024).
- Each tool is off until an administrator enables it for the tenant.
- A tool belongs to the module whose contract it wraps. While that module
  is off, its tools do not exist for that tenant: they are absent from the
  tool list, and calling one by name gets the same error as an unknown
  tool.

### Control 2: delegated, never shared

- **Each connection is authorised by a named user,** through OAuth 2.1's
  authorisation code flow with PKCE (`S256` only). The user signs in to the
  console as usual, with MFA, and approves the connection on a consent
  screen that lists the tools, modules, programmes and whether writes are
  allowed. Redirect addresses must match exactly.
- **Only registered clients.** A tenant administrator registers each agent
  client the tenant allows, with its redirect addresses. Open dynamic
  client registration is off.
- **At most the user's own permissions.** On every call, the connection
  acts with the intersection of its scopes and the user's permissions and
  reach at that moment, record-level ones included (ADR 0037). Break-glass
  never counts for a connection.
- **Pinned to one tenant and its cell.** A token's audience is that cell's
  MCP server, and its tenant is fixed in the token's row. No token works
  for another tenant or another cell.
- **Scoped** per module and per programme. Read-only unless the user grants
  write scopes separately, on the consent screen, for tools the
  administrator has allowed to write.
- **Short-lived tokens.** Access tokens are opaque, valid for 15 minutes and
  stored as hashes, so revocation takes effect at once. Refresh tokens
  rotate on each use; a reused refresh token revokes the whole connection.
  A connection lapses after 30 days unused and 90 days in all, after which
  the user approves it again.
- **Its own revocation.** The user can revoke a connection, and so can a
  tenant administrator. A connection is revoked when its user loses access:
  the membership is suspended or removed, the account is deactivated, or
  the password or MFA is reset (ADR 0010). A role change takes effect on
  the next call, because permissions are read then.
- **Never a service account.** A connection has no identity of its own
  beyond the user who made it, and never uses a role with `BYPASSRLS`.
- **The authorisation server** sits with authentication in the API, so
  sign-in, MFA and revocation stay in one place (ADR 0007). Better Auth's
  own OAuth provider support is the first option to assess. The wave 2 task
  chooses, and makes its ADR 0002 dependency check; nothing is added now.

### Control 3: humans decide

- No tool can award, reject, release, pay, record an outcome, decide an
  approval, change a role or permission, erase, or use break-glass
  (rule 9).
- **The catalogue mark is the control.** A route contract carries a
  **wrappable by a tool** mark, off unless the contract sets it and
  reviewed with the contract. Only marked routes can become tools: the
  server refuses to start with a tool over an unmarked route.
- Routes under the rule-9 set of permissions that ADR 0044 keeps are never
  marked: recording or changing decisions (`grants.decisions.record`),
  release, approvals, members, teams, roles and permissions, erasure,
  break-glass, sanctions match decisions, and `finance`'s payment and bank
  details routes. A unit test fails if any route under a permission in
  that set is marked, and if any route that needs step-up is marked.
- Step-up is a second guard where a route has it: no connection can step
  up, so such a route refuses a connection even if mismarked. Not every
  rule-9 route has step-up (`grants.decisions.record` has none), so the
  mark and its test, not step-up, keep a tool from recording an outcome.
- Write tools only **draft and propose**: a draft note, a draft message, a
  draft assessment, a proposed change. Each draft is marked as made through
  a connection, with the user's name. A named person confirms it in
  Fairfold's own screens, with step-up where ADR 0038 asks for it. A draft
  never takes effect on a timer or by itself.

### Control 4: least data

- **The classification map sets a ceiling** per connection. `internal` by
  default; `personal` only for tools the administrator allows it on and the
  user grants it to. Fields above the ceiling are left out, as the audience
  projection leaves out fields a role may not see.
- **Special category data is never exposed** through a connection in v1,
  including equality and monitoring answers. Aggregate-only data stays
  aggregate: at most the suppressed tables ADR 0032 allows.
- **A reviewer's agent gets the blind review projection** when the round is
  blind (ADR 0004), and only the applications assigned to that reviewer.
- **Private decisions stay private until release** (rule 8): outcomes,
  amounts, feedback, scores and recommendations are not readable through a
  connection until the decision is released, whatever the user's own
  permissions. A user who needs them reads them in Fairfold.
- No tool exports in bulk, downloads files, or reads the audit log. Lists
  return at most 50 records a page.

### Control 5: audit

- Every tool call writes an audit event (rule 4) naming the user, the
  connection, the tool, the records it touched and a result code. Values
  are ids and codes only, never arguments, prompts or results.
- A sensitive read through a connection writes the same sensitive-read
  event as it would for the person, with the connection named as well.
- Administrators see each connection's activity in the console: who made
  it, when it was last used, its tools and its calls. Users see their own.
- Connections and their changes are audited: created, scopes changed,
  revoked, lapsed.

### Control 6: limits

- Rate limits per connection and per tenant, as buckets in
  `app.request_limit` ([ADR 0028](0028-idempotency-keys.md)), and a read
  budget per connection: the number of records read in an hour and in a
  day. Crossing it pauses the connection's reads and tells the tenant's
  administrators.
- A kill switch per connection (revoke) and per tenant (turn agent access
  off, which refuses every token at once), and one for the whole cell,
  held by the operator.

### Banned uses

Until the AI governance ADR (Q2 2027) takes them over:

- No tool serves recruitment screening. `people` exposes no tools.
- In an EU cell, no tool feeds eligibility checks for public benefits, such
  as a council's: no eligibility tool exists there, and no tool returns an
  eligibility result. The EU AI Act lists both uses as high risk
  (Annex III; GK).

### Threats

| Threat                                           | What stops it                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection through applicant-supplied text | Tool output is data, never instructions: text from applicants and other outside sources is returned in fields marked as untrusted content, and the server never acts on it. No tool chains to a write by itself; writes need a write scope the user granted, and only make drafts that a person confirms (control 3) |
| Token theft and replay                           | Opaque tokens stored as hashes, valid for 15 minutes, bound to one cell's server and one tenant; refresh rotation with reuse detection; revocation at once; sending tokens only over HTTPS. Sender-constrained tokens (DPoP, GK) are assessed in wave 2                                                              |
| Confused deputy across tenants                   | The tenant comes from the token's row, never from a tool argument; the audience is checked on every call; the server never passes a token on to another service; every call runs under the tenant's row-level security                                                                                               |
| Bulk export through many small reads             | No export or file tools; 50 records a page; the read budget per connection, with administrators told when it is crossed; break-glass never counts; the audit trail shows every record touched                                                                                                                        |
| A user grants more than they meant               | The consent screen lists every tool and scope in plain words; writes and `personal` data are separate grants; administrators can narrow or revoke any connection                                                                                                                                                     |
| A compromised agent provider                     | It sees only what its connections may read, within the ceiling and limits above, and every read is audited; the tenant can kill every connection at once                                                                                                                                                             |

### Order of build

- Read tools first, then draft-and-propose tools, both with `connect` in
  wave 2 (Q1 2027), launched in June 2027.
- `assist` (wave 4) uses the same server and the same six controls, so one
  set of permissions, scopes, audit and kill switches covers both.
- Agent access is covered by `connect`'s wave 2 threat model and its DPIA
  addendum before launch. The DPIA addendum records that a connection sends
  data to a destination the funder chooses, for which the funder is
  responsible.
- The server's code is on the list that Aaron reviews line by line, with
  authentication and audit.

### Not built now

No server, authorisation library, schema or contract is added by this ADR.
The tables `connect` will build, each with `tenant_id`, row-level security
and a cross-tenant denial test, are: the tenant's agent settings and
enabled tools, registered clients, connections with their scopes and
ceiling, and token hashes.

## Consequences

- Rule 2: connections are pinned to one tenant and cell and run under
  row-level security; every new table has a cross-tenant denial test.
- Rule 4: every call and every connection change is audited, with ids and
  codes only.
- Rule 5: the classification map sets what a connection may read, and
  every new column is classified.
- Rule 6: the acting user comes from the connection's token, never from a
  tool argument.
- Rule 8: decision fields are not readable through a connection before
  release.
- Rule 9: no tool decides; rule-9 routes are never wrappable, a test keeps
  them so, and a named person confirms every draft.
- Funders get agent access without a service account or a bulk export,
  and can see and stop what each agent does.
- Some useful agent work, such as reading equality data or unreleased
  decisions, is refused by design. The AI governance ADR may revisit it
  with its own safeguards.
- Route contracts gain the "wrappable by a tool" mark, with its test
  against ADR 0044's rule-9 set, and the audit log gains a connection
  field; both arrive with `connect` in wave 2.

## Dependency check

No dependency is added. The authorisation server option is checked under
[ADR 0002](0002-licence-and-dependency-policy.md) by the wave 2 task that
chooses it.
