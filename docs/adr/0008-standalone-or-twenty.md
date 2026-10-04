# ADR 0008: Standalone or Twenty for the relationship layer

- **Status:** accepted; proposed partial supersession in [ADR 0017](0017-bespoke-crm-party-core.md)
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

The [V1 plan](../V1-PLAN.md#decisions-needed-before-kickoff) asks whether we
build standalone or use Twenty, an open source CRM, for the relationship
layer. V1 leaves out any organisation and contact CRM beyond the applicant's
own profile; Phase 2 adds it. The choice still shapes the data model now,
through `ApplicantAccount` and `ApplicantOrganisation`.

What we found about Twenty (v2.41.0, 17 September 2026, 57k GitHub stars,
active daily):

- Licence: mostly AGPL-3.0, with a section 7 exception for apps built on its
  published interfaces and MIT for its SDKs. Files marked `@license
  Enterprise` are under a commercial licence, and these include its SSO
  module.
- Stack: its own server and worker, PostgreSQL and Redis (from its Compose
  file), with its own auth, permissions, and workspace model for tenancy.
- Data model: custom objects defined at runtime through its metadata layer,
  not tables we write migrations for.

Our non-negotiables: tenant isolation by our RLS, enforced foreign keys, an
append-only audit log, a classification for every field, one container stack,
and nothing held back from self-hosters.

## Options considered

1. **Standalone for V1, with a CRM-ready organisation model.**
   - Pros: one stack, one database and one set of controls. No Redis and no
     commercially licensed code. V1 needs only the applicant's own profile.
   - Cons: Phase 2 must build the organisation and contact layer or integrate
     one. None of Twenty's CRM screens come for free.
2. **Build on Twenty,** with programmes, applications and reviews as Twenty
   objects or apps.
   - Pros: a polished CRM interface, runtime custom objects, APIs and webhooks.
     The relationship layer is ready on day one.
   - Cons: Twenty would own auth, tenancy, permissions and the data model,
     which conflicts with our RLS, foreign key, audit and classification rules.
     It adds Redis and two more services to every install. Its SSO is under a
     commercial licence, which conflicts with giving self-hosters everything.
     Its release pace would become ours.
3. **Standalone core, with Twenty as an optional connector later.** A Phase 2
   plugin syncs organisations and contacts both ways through Twenty's API and
   webhooks.
   - Pros: funders who want a CRM can have one. The core is unaffected.
   - Cons: sync, identity matching and conflict handling are real work. It
     depends on the plugin API.

## Decision

Option 1 now, keeping option 3 open for Phase 2. Rules for the organisation
model, for the schema work in sprints 2 to 6:

- Organisations, applicant accounts and the link between them are separate
  tables. The link has its own table with a role, so contacts can hang off
  organisations later without reshaping accounts.
- Every table has a UUID primary key, `tenant_id` with RLS, and created and
  updated timestamps and actors. In V1 an organisation belongs to one tenant.
  Sharing across funders (the applicant passport) is Phase 4 and needs its own
  DPIA.
- Links between these tables use composite foreign keys, `(tenant_id,
  parent_id)` to `(tenant_id, id)`, as
  [ADR 0003](0003-query-builder-and-migrations.md) requires, so an account can
  never be linked to another tenant's organisation.
- Registered identifiers (charity, company and similar numbers) sit in their
  own table using org-id.guide scheme codes such as `GB-CHC` and `GB-COH`,
  the same identifiers 360Giving uses. One key serves the 360Giving export and
  later CRM matching. They are unique on `(tenant_id, scheme, identifier)`,
  not globally, because two funders can each hold the same charity.
- Addresses are structured fields. Contact details are classified as personal
  data with a retention rule.
- No CRM-specific columns. When a connector arrives, an external reference
  table maps our ids to the other system's ids.
- Changes to organisations are audited and exposed through the API and the
  change feed, so a CRM can follow them later.

## Consequences

- V1 stays one stack with one set of controls, and the self-hosted install
  stays small.
- Phase 2 planning revisits the CRM question with a new ADR, with real usage
  from design partners to judge by.
- A Twenty connector would be our code under our licence. Twenty's
  application exception covers apps on the Twenty side. Our own plugin
  exception ([ADR 0002](0002-licence-and-dependency-policy.md)) covers
  plugins on ours.
- If a design partner already runs a CRM, V1 offers CSV export and the change
  feed, not live sync.

## Dependency check

No dependency is added. Twenty was assessed as a platform:

| Project | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| Twenty (not chosen for V1) | 2.41.0 | AGPL-3.0 with section 7 exception; MIT SDKs; commercial files | 2026-09-17 | Active; SSO under commercial licence; needs Redis |
