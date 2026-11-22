# Control mapping

This page maps the software to the ISO/IEC 27001:2022 Annex A controls and to
the five Cyber Essentials Plus technical themes. It uses control numbers and
our own short titles. It does not reproduce the standard. Buy the standard
for the full text.

Read it with the [README](README.md). It says where code, tests and runbooks
exist. It does not say that your deployment meets any control, that the
project is certified, or that any audit has passed.

## Status key

| Status | Meaning |
| --- | --- |
| Provided | The software does it. The evidence shows where. |
| Supported | The software or a runbook helps. You configure it or run it. |
| Operator only | No software can do it. It is yours. |

## Where the key evidence lives

| Topic | Evidence |
| --- | --- |
| Accounts, sessions and MFA | [ADR 0010](../adr/0010-authentication-security-rules.md), `apps/api/src/auth/` |
| Tenant isolation | [Architecture rule 2](../ARCHITECTURE.md), `packages/db/test/cross-tenant.ts` |
| Audit and retention purge | [Architecture rule 4](../ARCHITECTURE.md), [ADR 0003](../adr/0003-query-builder-and-migrations.md), `packages/db/test/app/audit-event.test.ts`, `packages/db/test/app/audit-purge.test.ts` |
| Field classification | [Architecture rule 5](../ARCHITECTURE.md), `packages/db/classification.ts`, `packages/db/src/records-of-processing.ts` |
| Logging and monitoring | `infra/observability/`, `apps/api/src/redaction.ts` |
| Backups | [ADR 0011](../adr/0011-backups-and-recovery.md), `infra/backup/`, [restore runbook](../runbooks/restore.md) |
| Secure development | `.github/workflows/ci.yml`, `infra/semgrep/`, [ADR 0002](../adr/0002-licence-and-dependency-policy.md) |
| Change management | [Architecture rule 10](../ARCHITECTURE.md), `apps/api/src/platform/config-versions.ts` |
| Outbound requests | [ADR 0010, part 2](../adr/0010-authentication-security-rules.md), `apps/api/src/outbound/` |
| Malware scanning of uploads | [ADR 0030](../adr/0030-files-and-reverse-proxy.md), `apps/api/src/platform/files/clamd.ts` |
| Incident response | [Incident runbook](../runbooks/incident.md) |

## ISO/IEC 27001:2022 Annex A

There are 93 controls in four themes. Where a control mixes software and
operator duties, the status shows the software's share and the last column
says what stays with you.

### Organisational controls (5.1 to 5.37)

| No. | Short title | Status | Evidence or note |
| --- | --- | --- | --- |
| 5.1 | Security policies | Operator only | Write your own. |
| 5.2 | Security roles and duties | Operator only | The software's roles are under 5.15. |
| 5.3 | Separation of duties | Supported | Roles split staff powers, and recording a decision is separate from releasing it: [Team and roles](../admin/team-and-roles.md), [Releasing decisions](../admin/releasing-decisions.md). You assign the roles. |
| 5.4 | Management duties | Operator only | |
| 5.5 | Contact with authorities | Supported | The [incident runbook](../runbooks/incident.md) has the 72-hour route to the Information Commissioner's Office (ICO). You name the contact. |
| 5.6 | Contact with specialist groups | Operator only | |
| 5.7 | Threat intelligence | Operator only | The project's own dependency audits are under 8.8. |
| 5.8 | Security in projects | Operator only | |
| 5.9 | Inventory of information and assets | Supported | [Records of processing](dpia-template.md#data-flows) from the classification map; [SBOMs](sbom-and-licences.md). You list your own assets. |
| 5.10 | Acceptable use | Operator only | |
| 5.11 | Return of assets | Operator only | |
| 5.12 | Classifying information | Provided | Every column has a sensitivity and a retention rule: `packages/db/classification.ts`. |
| 5.13 | Labelling information | Operator only | The map classifies data in code. Labels on your documents are yours. |
| 5.14 | Transferring information | Supported | [Outbound request rules](../adr/0010-authentication-security-rules.md); [exports](../admin/exports.md). You set TLS and email transport. |
| 5.15 | Access control | Provided | Server-side permissions and roles: `apps/api/src/policy/`; [Team and roles](../admin/team-and-roles.md). |
| 5.16 | Identity management | Provided | Invitations, memberships and deactivation: [ADR 0010](../adr/0010-authentication-security-rules.md), [Deactivation runbook](../runbooks/deactivation.md). |
| 5.17 | Authentication information | Provided | Passwords of at least 12 characters, MFA and a reset flow: [ADR 0010](../adr/0010-authentication-security-rules.md), `apps/api/src/auth/`. |
| 5.18 | Access rights | Supported | [Onboarding runbook](../runbooks/onboarding.md), [Deactivation runbook](../runbooks/deactivation.md). You review who holds which role. |
| 5.19 | Supplier relationships | Operator only | |
| 5.20 | Supplier agreements | Operator only | |
| 5.21 | Supply chain security | Supported | Licence policy, signed images, SBOMs, pinned tool checksums and monthly dependency updates: [ADR 0002](../adr/0002-licence-and-dependency-policy.md), `.github/tool-checksums.sha256`, `.github/dependabot.yml`. You vet your own suppliers. |
| 5.22 | Monitoring supplier services | Operator only | |
| 5.23 | Cloud services | Operator only | The platform runs on vanilla PostgreSQL and S3-compatible storage: [ADR 0012](../adr/0012-hosting-targets-and-cells.md). Choosing and securing a host is yours. |
| 5.24 | Incident planning | Supported | [Incident runbook](../runbooks/incident.md). You staff it and name the lead. |
| 5.25 | Assessing events | Supported | The severity table in the [incident runbook](../runbooks/incident.md). |
| 5.26 | Responding to incidents | Supported | [Incident runbook](../runbooks/incident.md), [Lockout runbook](../runbooks/lockout.md), [Secret rotation](../runbooks/secret-rotation.md). |
| 5.27 | Learning from incidents | Operator only | |
| 5.28 | Collecting evidence | Supported | The append-only audit log and its copy outside the database: [Audit copy runbook](../runbooks/audit-copy.md), [Audit log guide](../admin/audit-log.md). |
| 5.29 | Security during disruption | Supported | [Restore runbook](../runbooks/restore.md), [ADR 0011](../adr/0011-backups-and-recovery.md). |
| 5.30 | ICT readiness for continuity | Supported | The backup job in `infra/backup/`. A restore rehearsal record is not yet available. |
| 5.31 | Legal and contract requirements | Supported | [Records of processing](dpia-template.md#data-flows), subject access, erasure and retention: [Retention and subject access](../admin/retention-and-subject-access.md). You remain the data controller. |
| 5.32 | Intellectual property | Supported | Licence policy: [ADR 0002](../adr/0002-licence-and-dependency-policy.md), [SBOM and licences](sbom-and-licences.md). |
| 5.33 | Protecting records | Provided | The audit table is append-only for the app role, and one named function purges rows past retention: [ADR 0003](../adr/0003-query-builder-and-migrations.md), `packages/db/test/app/audit-purge.test.ts`. |
| 5.34 | Privacy and personal data | Provided | Row-level security, classification, subject access and erasure: [ADR 0027](../adr/0027-erasure-across-modules-and-audit.md), `packages/db/test/erasure/`. You decide lawful bases and write notices. |
| 5.35 | Independent review | Operator only | No external penetration test or audit result is available yet. |
| 5.36 | Compliance with policies | Operator only | |
| 5.37 | Written operating procedures | Supported | [Runbooks](../runbooks/README.md), [Administrator guide](../admin/README.md). |

### People controls (6.1 to 6.8)

| No. | Short title | Status | Evidence or note |
| --- | --- | --- | --- |
| 6.1 | Screening | Operator only | |
| 6.2 | Terms of employment | Operator only | |
| 6.3 | Awareness and training | Operator only | |
| 6.4 | Disciplinary process | Operator only | |
| 6.5 | Duties after leaving | Supported | Deactivating an account revokes its sessions: [Deactivation runbook](../runbooks/deactivation.md). You run the leaver process. |
| 6.6 | Confidentiality agreements | Operator only | |
| 6.7 | Remote working | Supported | Idle and absolute session timeouts, and required MFA for staff: [ADR 0010](../adr/0010-authentication-security-rules.md). Staff devices are yours. |
| 6.8 | Reporting events | Supported | [Incident runbook](../runbooks/incident.md); the [security policy](../../SECURITY.md) for outside reporters. |

### Physical controls (7.1 to 7.14)

Every physical control is yours. On a managed host, it is your provider's.

| No. | Short title | Status | Evidence or note |
| --- | --- | --- | --- |
| 7.1 | Physical perimeters | Operator only | |
| 7.2 | Physical entry | Operator only | |
| 7.3 | Securing offices and rooms | Operator only | |
| 7.4 | Physical security monitoring | Operator only | |
| 7.5 | Physical and environmental threats | Operator only | |
| 7.6 | Working in secure areas | Operator only | |
| 7.7 | Clear desk and screen | Operator only | |
| 7.8 | Siting equipment | Operator only | |
| 7.9 | Equipment off premises | Operator only | |
| 7.10 | Storage media | Operator only | |
| 7.11 | Supporting utilities | Operator only | |
| 7.12 | Cabling | Operator only | |
| 7.13 | Equipment maintenance | Operator only | |
| 7.14 | Secure disposal of equipment | Operator only | |

### Technological controls (8.1 to 8.34)

| No. | Short title | Status | Evidence or note |
| --- | --- | --- | --- |
| 8.1 | User endpoint devices | Operator only | See Cyber Essentials Plus below. |
| 8.2 | Privileged access | Supported | Operator roles are separate from tenant roles: [ADR 0010](../adr/0010-authentication-security-rules.md), `packages/db/test/app/operator-role.test.ts`. You limit who holds them. |
| 8.3 | Restricting information access | Provided | Row-level security and permissions, and decisions stay private until released: [Architecture rules 2 and 8](../ARCHITECTURE.md), `packages/db/test/cross-tenant.ts`. |
| 8.4 | Access to source code | Operator only | The source is open. Control your own fork. |
| 8.5 | Secure authentication | Provided | MFA, rate limits and session rules: [ADR 0010](../adr/0010-authentication-security-rules.md), `apps/api/src/auth/mfa.integration.test.ts`. |
| 8.6 | Capacity management | Supported | Rate limits in `apps/api/src/limits/`; dashboards and alerts in `infra/observability/`. You size the host. |
| 8.7 | Protection against malware | Supported | ClamAV scans uploads, and a file is stored only when clean: [ADR 0030](../adr/0030-files-and-reverse-proxy.md), `apps/api/src/platform/files/clamd.ts`. You keep the ClamAV signatures current and protect devices. |
| 8.8 | Managing technical vulnerabilities | Supported | CI runs `pnpm audit`, Trivy and Semgrep: `.github/workflows/ci.yml`. Fix targets are in the [security policy](../../SECURITY.md). You apply updates to your install. |
| 8.9 | Configuration management | Supported | Tenant configuration is versioned (rule 10), and infrastructure is code in `infra/`. Hardening guide: not yet available. |
| 8.10 | Deleting information | Provided | Erasure across modules, retention and a file sweep: [ADR 0027](../adr/0027-erasure-across-modules-and-audit.md), `packages/db/test/app/file-sweep.test.ts`. Copies in your backups follow your backup retention. |
| 8.11 | Masking data | Provided | Logs and job errors hold ids and codes, not answers: `apps/api/src/redaction.ts`. Equality answers are shown only as counts: [ADR 0032](../adr/0032-equality-and-monitoring-data.md). |
| 8.12 | Preventing data leaks | Supported | Private decisions, export permissions, the outbound request guard and response headers: `apps/api/src/headers.ts`. Network egress filtering is yours. |
| 8.13 | Information backup | Supported | A nightly encrypted snapshot job: `infra/backup/`, [ADR 0011](../adr/0011-backups-and-recovery.md). You run it, hold the keys and test restores. A restore rehearsal record is not yet available. |
| 8.14 | Redundancy | Operator only | |
| 8.15 | Logging | Provided | An `audit_event` for state changes, decisions, permission changes and sensitive reads, and structured logs: [Audit log guide](../admin/audit-log.md). |
| 8.16 | Monitoring | Supported | Alerts and dashboards in `infra/observability/`. You deploy them and watch the alerts. |
| 8.17 | Clock synchronisation | Operator only | |
| 8.18 | Privileged utility programs | Supported | The app connects as a role without the bypass-row-level-security right: `packages/db/test/privilege-lint.test.ts`. You control who has database superuser access. |
| 8.19 | Installing software in production | Supported | Signed release images: [SBOM and licences](sbom-and-licences.md). You deploy only images you have verified. |
| 8.20 | Network security | Supported | A reverse proxy that answers only named hosts: [ADR 0030](../adr/0030-files-and-reverse-proxy.md), `infra/proxy/`. Firewalls are yours. |
| 8.21 | Security of network services | Supported | The proxy offers TLS 1.2 and 1.3 and sends HSTS: `infra/proxy/nginx.conf`. You provide the certificate. |
| 8.22 | Network segregation | Supported | The Compose stack puts the database on a private network: `infra/compose/`. |
| 8.23 | Web filtering | Operator only | |
| 8.24 | Use of cryptography | Supported | Password hashing, encrypted authenticator secrets and `age` encryption of backups: [ADR 0010](../adr/0010-authentication-security-rules.md), `infra/backup/README.md`. You manage keys: [Secret rotation](../runbooks/secret-rotation.md). |
| 8.25 | Secure development life cycle | Provided | Pull-request checks, tests and review rules: `.github/workflows/ci.yml`, [CONTRIBUTING](../../CONTRIBUTING.md). |
| 8.26 | Application security requirements | Provided | [Architecture rules](../ARCHITECTURE.md); the server re-validates every input. |
| 8.27 | Secure architecture | Provided | [Architecture rules](../ARCHITECTURE.md), [ADR 0010](../adr/0010-authentication-security-rules.md). |
| 8.28 | Secure coding | Provided | Custom Semgrep rules in `infra/semgrep/`, and lint and type checks in CI. |
| 8.29 | Security testing | Supported | Unit, database, end-to-end and accessibility tests run in CI. An external penetration test is not yet available. |
| 8.30 | Outsourced development | Operator only | |
| 8.31 | Separate development, test and production | Supported | `pnpm dev` and `pnpm stack` use synthetic data, and the seed refuses any database that is not a development one: `packages/db/seed/guard.ts`. |
| 8.32 | Change management | Supported | Programme, stage, rubric, form and template changes create a versioned record with author and diff (rule 10). Changes to your own install need your own process. |
| 8.33 | Test information | Provided | Tests and demonstrations use synthetic data only. |
| 8.34 | Protecting systems during audit testing | Operator only | |

## Cyber Essentials Plus

**Cyber Essentials Plus certifies an organisation, not software.** A
certification body assesses your devices, network and settings. This
software cannot make you certified, and its authors do not claim it can.

**Requirements version:** not yet available. Confirm the "Requirements for IT
infrastructure" version and its date on the scheme's website when you apply.
This edition does not name one, because it was not checked.

The software's evidence helps with the technical themes below.

| Theme | What the software does | What your devices and network must do |
| --- | --- | --- |
| Firewalls | The reverse proxy answers only the hosts you name: [ADR 0030](../adr/0030-files-and-reverse-proxy.md). The API refuses to start with a forward proxy set, and its outbound requests refuse private and metadata addresses: [ADR 0010](../adr/0010-authentication-security-rules.md). | Run a boundary firewall. Close every port you do not use. Filter egress from the containers, which Compose cannot do. Keep the database off the internet. |
| Secure configuration | The API refuses some unsafe settings at start, for example plain SMTP to anything but a loopback address: `apps/api/src/config.ts`. Hardening guide: not yet available. | Remove default accounts and unused services. Set a device lock on every in-scope device. |
| User access control | Required MFA for staff, role-based permissions, session timeouts and account deactivation: [ADR 0010](../adr/0010-authentication-security-rules.md), [Team and roles](../admin/team-and-roles.md). | Give each person their own accounts. Limit administrator accounts. Use MFA for your cloud and email accounts. |
| Malware protection | ClamAV scans uploads before they are stored: [ADR 0030](../adr/0030-files-and-reverse-proxy.md). | Run anti-malware or application allow-listing on every in-scope device and keep it current. |
| Security update management | Releases ship signed images with SBOMs, CI audits dependencies, and the [security policy](../../SECURITY.md) sets fix targets: [SBOM and licences](sbom-and-licences.md). | Apply updates on every in-scope device, the container host and the database within the period the requirements set for high and critical fixes. Remove unsupported software. |

The Plus level adds a hands-on test of a sample of your devices and a
vulnerability scan of your internet-facing systems. No software evidence
replaces that test.

## Hardening guide

The hardening guide is not yet available. Once it merges, this pack will
link it from the [README](README.md) and list here which controls each
section supports. Until then, the controls above are the starting list.

## Review

This mapping needs a line-by-line review by the project lead before
publication. That review is not yet recorded.
