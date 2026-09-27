# PixelGrant: V1 Development Plan

Aaron Gardner, 26 September 2026

## Scope and success

V1 lets a design-partner funder run one real funding round end to end, from opening a programme to releasing decisions, on a secure, compliant core. It is delivered in 12 two-week sprints (about 24 weeks) and ends at Gate 1, before any live applicant data is accepted.

The product vision, compliance framework and architecture principles are in the companion strategy doc, *PixelGrant: The Gift and the Service*. This plan assumes those decisions stand.

**V1 delivers:**

1. A secure multi-tenant core: authentication with MFA and SSO, role-based access, tenant isolation, an immutable audit log and data-governance tooling.
2. Programme set-up: programmes, rounds, stages, rubrics and email templates, configurable without code.
3. A form builder and an accessible applicant portal.
4. Eligibility screening and a staff triage workspace.
5. Assessment: reviewer assignment, conflict-of-interest recusal, blind review and rubric scoring.
6. Private decisions with bulk release.
7. Data out: 360Giving export, CSV export and a change feed to BigQuery or another warehouse.
8. Deployment as one container stack, on the managed Google Cloud service and via Docker Compose.

**Success criteria:**

| Measure | Target |
| --- | --- |
| Design partner runs a real round fully on the platform | 1 round, all stages |
| Applicants who start an application and submit it | ≥ 80% |
| Staff admin time per application versus partner's current tool | Measurably lower, baseline taken in sprint 1 |
| WCAG 2.2 AA on applicant and reviewer journeys | No open level A or AA failures |
| Penetration test high or critical findings open at go-live | 0 |
| Restore from backup | Tested and documented, under 4 hours |
| Fresh self-hosted install from docs | Under 1 hour for a competent admin |

## Out of scope for V1

These are deliberately deferred to Phase 2 or later. Requests for them during V1 go to the backlog, not the sprint.

- Grant agreements, e-signature, payment schedules and finance exports.
- Monitoring reports, follow-up forms and closeout.
- Organisation and contact CRM layer beyond the applicant's own profile.
- Companies House and Charity Commission lookups, sanctions screening and fraud controls.
- Plugin API (V1 keeps internal extension points clean so the API can be published in Phase 2).
- AI features of any kind.
- Reviewer calibration and portfolio analytics dashboards (reporting happens in the warehouse).
- Multi-language interface (English only, with text externalised so translation is possible later).
- Native mobile apps (responsive web only).

## Technical baseline

One TypeScript monorepo, one Postgres database, one container stack. Every choice must run on vanilla Postgres in Docker; nothing may depend on a Google-only feature.

### Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript throughout | Strict mode |
| Frontend | React, Vite, Tailwind, accessible component library (Radix-based) | Two apps: staff console and applicant portal |
| Backend | Node.js with Fastify, typed API with OpenAPI schema generated from code | Server re-validates everything the client sends |
| Shared domain | `packages/domain`: form engine, eligibility rules, stage logic, validation | Runs identically in browser and server |
| Database | PostgreSQL 16+, row-level security for tenancy | Enforced foreign keys and constraints |
| Data access | Typed SQL query builder with versioned migrations (Drizzle or Kysely) | Migrations reviewed like code |
| Auth | Open-source auth supporting TOTP and WebAuthn MFA, OIDC and SAML SSO | Library choice is an open decision |
| Background jobs | pg-boss (Postgres-backed queue) | No extra infrastructure to host |
| Files | S3-compatible storage, virus scanning with ClamAV on upload | Cloud Storage in managed service |
| Email | Provider-agnostic SMTP adapter | Templates versioned in config |
| Observability | OpenTelemetry traces and metrics, structured JSON logs | Sensitive fields redacted at source |
| Infrastructure | Terraform for Google Cloud; Docker Compose and Helm chart for self-hosting | Same images everywhere |

### Repository layout

```
apps/
  api/            Fastify server, endpoints, jobs
  console/        staff and reviewer app
  portal/         applicant app
packages/
  domain/         forms, eligibility, stages, scoring, shared types
  db/             schema, migrations, RLS policies, seed data
  ui/             accessible component library
  config/         programme config schema and validators
infra/
  terraform/      managed service on Google Cloud
  compose/        self-hosted Docker Compose
  helm/           Kubernetes chart
docs/             admin guide, hardening guide, evidence pack
```

### Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | Development, Docker Compose | Synthetic seed only |
| CI | Automated tests per pull request | Ephemeral, synthetic |
| Staging | Integration, UAT with design partners, pen test target | Synthetic only |
| Production | Managed service, `europe-west2` | Live data only after Gate 1 |

### Pipeline on every pull request

Type check, lint, unit and integration tests, Playwright end-to-end tests, axe accessibility checks, static analysis (Semgrep or CodeQL), dependency and container vulnerability scan (Trivy), secrets scan (gitleaks), licence check and SBOM generation (Syft). Merges need one approving review and a green pipeline. Releases are tagged, built once, signed and promoted through environments unchanged.

## Core data model

The application submission is the centre of the model. Every table carries `tenant_id`, protected by row-level security, plus created and updated timestamps and actor.

```
Tenant ──< Membership >── User (staff, reviewers)
   │
   ├──< Programme ──< Round ──< Stage ──> Rubric ──< Criterion
   │        │           └──< ReviewerPool >── User
   │        └──< Form ──< FormVersion (JSON field definitions)
   │
   ├──< ApplicantAccount >── ApplicantOrganisation
   │
   └──< Application (Round, FormVersion, ApplicantAccount)
            ├── answers (JSON keyed by stable field id)
            ├──< EligibilityResult
            ├──< ReviewAssignment ──< Review ──< Score (per Criterion)
            ├──< ConflictDeclaration
            ├──< Decision (outcome, amount, released_at)
            ├──< Message · Note · Attachment
            └──< StageTransition

Cross-cutting: AuditEvent · FieldClassification · RetentionPolicy
               ConsentRecord · EmailTemplate · ConfigVersion
```

### Rules the team must hold to

- **Answers are keyed by stable field ids**, never labels, so renaming a question never orphans data. Applications pin the `FormVersion` they were submitted against.
- **Real foreign keys and constraints.** No text-typed foreign keys.
- **Every field has a classification** (public, internal, personal, special category) and a retention rule. Export, erasure, subject access and the warehouse feed all read these.
- **Audit events are append-only.** No update or delete permission exists on the table for the application role. Each event records actor, action, entity, before and after values, and request id.
- **Decisions are private until released.** Recording an outcome and notifying the applicant are separate operations; the portal only ever sees released outcomes.
- **Programme configuration is versioned.** Every change to stages, rubrics, forms or templates creates a `ConfigVersion` with author and diff.

## Epics and acceptance criteria

Twelve epics. Each is done only when its acceptance criteria pass in staging and the definition of done is met.

### E1 Platform foundation

- Monorepo, pipeline and all four environments running; a merged change reaches staging automatically.
- Docker Compose brings up the full stack locally with synthetic seed data in one command.
- Terraform provisions the managed environment from scratch with no manual steps.

### E2 Identity and access

- Staff sign in with email and password plus mandatory MFA (TOTP or WebAuthn); SSO via OIDC and SAML configurable per tenant.
- Applicants sign in with email verification; MFA optional but offered.
- Roles: Tenant Admin, Programme Manager, Reviewer, Applicant. Permissions checked server-side on every endpoint; the acting user always comes from the session.
- Automated tests prove one tenant cannot read or write another tenant's rows, including through direct SQL with the application role.
- Sessions expire after inactivity; admins can revoke sessions and deactivate users.

### E3 Audit and data governance

- Every create, update, delete, sensitive read, decision and permission change writes an audit event; admins can search and export the log.
- Field classification and retention rules configurable per tenant, with sensible defaults.
- A scheduled job deletes or anonymises data past its retention date and logs what it did.
- Subject access request: admin generates a complete machine-readable export for one person within minutes.
- Erasure request: removes or anonymises a person's personal data while preserving the audit trail's integrity.

### E4 Programme configuration

- Managers create programmes and rounds with open and close dates in a stated timezone, budget and late-submission policy.
- Stages are configurable (default Intake, Review, Decision), reorderable, each with its own rubric.
- Rubrics define criteria, weights and score scales.
- Programme configuration can be exported and imported as a versioned file; every change is logged as a `ConfigVersion`.

### E5 Form builder and engine

- Field types: short and long text with word limits, number, currency, date, email, phone, URL, single and multiple choice, dropdown, yes/no, file upload, address, and content blocks.
- Sections as steps, conditional show and hide logic, required rules and validation, per-field hide-from-reviewers flag.
- Live applicant preview; publishing a form creates an immutable version.
- The same form engine validates in browser and on server; server rejects anything the client should have blocked.

### E6 Applicant portal

- Applicants browse open programmes, see eligibility, dates and award ranges before starting.
- Multi-step application with autosave, file upload, a review page listing missing items, submit and withdraw.
- Status tracking shows only released outcomes; secure messaging with the funder.
- Applicant journey passes WCAG 2.2 AA manual audit, works on mobile and with a screen reader.

### E7 Eligibility and triage

- Eligibility questions can stop an applicant early with a clear explanation, and staff can see eligibility results.
- Staff submissions list with filters (programme, round, stage, status, owner, score, late), saved views and bulk actions (move stage, assign owner, add label).
- Submission detail shows answers, attachments, history, notes with mentions and messages.

### E8 Assessment

- Reviewer pools per programme; assign reviewers manually or automatically by a set number per application, balanced by open workload.
- Reviewers declare conflicts before scoring; a declared conflict removes the assignment and is audited.
- Blind review hides applicant identity fields throughout the reviewer view.
- Scoring workspace shows the application beside the rubric, autosaves, and supports keyboard navigation.
- Managers see score spread between reviewers per application.

### E9 Decisions and notifications

- Managers record accept (with amount), waitlist or decline, singly or in bulk.
- Decisions remain private until released; release sends the matching email template and updates the portal.
- Email templates with merge fields, per-programme overrides, preview and test send.
- Scheduled reminders for unsubmitted drafts near deadline and for overdue reviews.

### E10 Data out

- 360Giving export for awarded grants, validated against the current standard, with tenant control over which fields publish.
- CSV export of any saved view, respecting permissions and field classification.
- Change feed to BigQuery (managed service) and a documented logical-replication route for self-hosters.
- Board pack PDF of selected applications.

### E11 Accessibility and design system

- Shared component library meets WCAG 2.2 AA, with axe checks in CI and documented keyboard patterns.
- Content style guide for plain-English interface text and error messages.

### E12 Operability

- Backups with point-in-time recovery; a timed restore rehearsal documented.
- Dashboards and alerts for errors, latency, job failures and security events.
- Runbooks for incident response, restore, user lockout and tenant onboarding.
- Admin guide and self-hosting hardening guide published in `docs/`.

## Delivery schedule

Twelve two-week sprints with four milestones. Security and governance come first so every later feature is built on them, not retrofitted.

| Sprint | Weeks | Focus | Epics |
| --- | --- | --- | --- |
| 1 | 1–2 | Repo, pipeline, environments, Terraform, design system start; baseline partner's current admin time | E1, E11 |
| 2 | 3–4 | Auth, MFA, roles, tenant isolation with RLS tests | E2 |
| 3 | 5–6 | Audit log, field classification, SSO | E2, E3 |
| 4 | 7–8 | Programmes, rounds, stages, rubrics, config versioning | E4 |
| 5 | 9–10 | Form engine and builder | E5 |
| 6 | 11–12 | Applicant portal: browse, apply, autosave, submit | E6 |
| 7 | 13–14 | Eligibility, staff submissions list, submission detail, messaging | E6, E7 |
| 8 | 15–16 | Reviewer pools, assignment, conflicts, blind review | E8 |
| 9 | 17–18 | Scoring workspace, decisions, release, email templates, reminders | E8, E9 |
| 10 | 19–20 | 360Giving export, CSV, change feed, board packs; retention, SAR and erasure tooling | E3, E10 |
| 11 | 21–22 | Hardening, accessibility audit fixes, runbooks, restore rehearsal; external pen test starts | E11, E12 |
| 12 | 23–24 | Pen test fixes, Cyber Essentials Plus assessment, design-partner UAT, Gate 1 review | All |

**Milestones**

| Milestone | End of sprint | Demonstrated by |
| --- | --- | --- |
| M1 Secure skeleton | 3 | Two tenants, MFA sign-in, isolation tests green, audit events visible |
| M2 Applicant can apply | 7 | Synthetic applicant submits to a configured programme; staff triage it |
| M3 End-to-end round | 10 | Full round on synthetic data: apply, assess, decide, release, export to 360Giving and BigQuery |
| M4 Gate 1 | 12 | All Gate 1 deliverables signed off; first live round approved to open |

Contingency: sprints 11 and 12 absorb slippage. If M3 slips by more than one sprint, cut scope from E10 (board packs first, then the change feed) rather than hardening time.

## Definition of done

A story is done only when all of the following are true. No exceptions for deadline pressure; unmet items become explicit, logged debt approved by the tech lead.

- [ ] Acceptance criteria pass in staging.
- [ ] Unit and integration tests cover the new logic; end-to-end test added for any user journey change.
- [ ] Permissions enforced server-side and covered by a test, including a cross-tenant denial test for any new data.
- [ ] Audit events written for any state change or sensitive read.
- [ ] New fields classified, with a retention rule, and included in export, SAR and erasure handling.
- [ ] Keyboard and screen-reader checked; no axe violations.
- [ ] Interface text follows the content style guide.
- [ ] Pipeline green: no new high or critical vulnerabilities, secrets or licence conflicts.
- [ ] Migrations reversible or with a documented rollback.
- [ ] Admin or self-hosting docs updated where behaviour changed.
- [ ] Reviewed and approved by at least one other engineer.

**Quality targets for V1:** p95 page response under 500 ms at design-partner load; zero known high or critical vulnerabilities at release; applicant pages usable on a 3G mobile connection.

## Gate 1 compliance deliverables

No live applicant data enters production until every item below is complete and signed off. The engineering team produces most of the evidence; the service company owns the certifications and contracts.

| Deliverable | Owner | Evidence | Due |
| --- | --- | --- | --- |
| ICO registration | Service company | Registration certificate | Before sprint 1 |
| Records of processing | Service company, with tech lead | Register covering all data categories in the model | Sprint 4 |
| DPIA for the managed service | Service company, with tech lead | Signed DPIA with risks and mitigations | Sprint 8 |
| Data processing agreement with each design partner | Service company | Signed DPAs | Sprint 10 |
| Privacy notice templates for funders and applicants | Service company | Published templates | Sprint 10 |
| Accessibility audit, WCAG 2.2 AA | External auditor | Report with all A and AA issues fixed; accessibility statement | Sprint 11 |
| Penetration test against OWASP ASVS Level 2 | External CREST-accredited tester | Report; high and critical issues fixed and retested | Sprint 12 |
| Cyber Essentials Plus | Service company | Certificate | Sprint 12 |
| Backup restore rehearsal | Engineering | Timed record of full restore to a clean environment | Sprint 11 |
| Incident response plan and breach procedure | Service company, with tech lead | Plan with 72-hour ICO reporting route; tabletop record | Sprint 11 |
| Security policy and disclosure route | Engineering | `SECURITY.md` and published contact | Sprint 1 |
| SBOM and licence inventory for the release | Engineering | Generated by pipeline for the Gate 1 release | Sprint 12 |
| Self-hoster evidence pack, first edition | Engineering | Control mapping, hardening guide, DPIA template | Sprint 12 |

The compliance list rests on general knowledge; confirm the regime list with a solicitor and security assessor before sprint 4.

## Team and ways of working

V1 needs about four full-time-equivalent people plus design-partner time. A smaller team stretches the schedule; it should not cut the hardening sprints.

| Role | Commitment | Responsibilities |
| --- | --- | --- |
| Product owner | 0.5 FTE | Backlog, priorities, design-partner relationships, sign-off on acceptance |
| Tech lead | 1 FTE | Architecture, security design, code review standards, Gate 1 evidence |
| Full-stack engineers | 2 FTE | Feature delivery across API, console and portal |
| UX and accessibility designer | 0.5 FTE | Journeys, design system, content style, usability testing |
| DevOps and security engineer | 0.5 FTE | Infrastructure, pipeline, monitoring, backups, security tooling |
| Design-partner representatives | 2–4 hours per sprint each | Sprint reviews, UAT, real-world configuration |

**Rhythm**

- Sprint planning and review every two weeks; design partners join reviews from sprint 4.
- Short daily stand-up; weekly security and architecture review with the tech lead.
- All work in the public repository from day one, with issues, decisions and roadmap open.
- Architecture decision records in `docs/adr/` for every significant choice.
- Usability testing with real applicants, including at least one disabled user, in sprints 7 and 10.

**Handover expectations for a delivery partner**

- Code, infrastructure and documentation live in the project's repository and cloud accounts, never the supplier's.
- All work is released under the project licence, with DCO sign-off on every commit.
- The supplier supports Gate 1 evidence gathering and the external pen test and accessibility audit.
- Weekly written progress against milestones, with risks flagged as they arise.

## Decisions needed before kickoff

These block sprint 1 or shape early architecture. Each needs an owner and an answer recorded as an architecture decision record.

- [x] Employment and IP position confirmed in writing.
- [ ] Legal entities in place: stewardship body and service company, or a single entity to start.
- [ ] Licence confirmed: AGPL-3.0 for the platform, permissive for the plugin API.
- [ ] Build standalone, or use Twenty for the relationship layer (affects Phase 2 more than V1, but shapes the data model now).
- [ ] Auth library chosen: an embedded library versus an external identity provider such as Keycloak.
- [ ] ORM or query builder chosen: Drizzle or Kysely.
- [ ] Delivery model: in-house hires, a delivery partner, or a mix.
- [ ] Three design partners signed, with a named contact and a target round date for each.
- [ ] Budget confirmed for external pen test, accessibility audit, Cyber Essentials Plus and hosting through Gate 1.
- [ ] Working product name and domain.
