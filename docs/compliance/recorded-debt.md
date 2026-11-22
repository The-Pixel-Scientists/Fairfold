# Recorded debt

The project's definition of done lists conditions every piece of work should
meet. The first release of the software, a full funding round on synthetic
data, did not meet two of them. They are logged as debt, and this page says
where each stands. It also lists the gaps the first release recorded, with
their state in the code on 19 November 2026.

The software is still a demonstration on synthetic data. Do not use it for
real applicants until you have completed your own assessment and the project's
own Gate 1 work is complete. Gate 1 covers the penetration test, Cyber
Essentials Plus, the data protection impact assessment, data processing
agreements and the audits.

## Definition-of-done items not met

| Item | State on 19 November 2026 | When it closes |
| --- | --- | --- |
| Acceptance criteria pass in staging | Open. The code that deploys signed images to a staging site exists, but no release has been tagged and staging takes no traffic. | When signed images first reach staging and the demonstration round's end-to-end test passes there. |
| Another engineer reviews and approves the work | Open. One maintainer reviews the work today. | When independent reviewers have checked sign-in and row-level security and the deferred sign-in features, and a second reviewer covers module server code. No date is promised. |

## Gaps the first release recorded

The first release's list of gaps is in
[what the first release leaves out](../demo/mvp1-known-gaps.md). That page is
older than the code. This table gives each group's state by what the code
holds now. "Closed" means the feature exists and has tests. It does not mean
the feature has had an external review.

| Group | State | Notes |
| --- | --- | --- |
| Sign-in with passkeys, single sign-on and backup codes | Closed in code | Passkeys, single sign-on, backup codes and email change are in `apps/api/src/auth/`. Not externally reviewed. |
| Rate limits and the outbound request guard | Closed in code | `apps/api/src/limits/`, `apps/api/src/outbound/`. |
| Retention, subject access and erasure across modules | Closed in code | `apps/api/src/platform/retention/`, `apps/api/src/platform/subject-access/`, `apps/api/src/platform/erasure/`. |
| Reverse proxy and file sweeping and rescanning | Closed in code | `infra/proxy/`, `apps/api/src/platform/files/`. |
| Runbooks for incidents, lockout, deactivation, restore and secret rotation | Closed, with limits | See [runbooks](../runbooks/README.md). The restore runbook says some steps have no command yet, and its recovery times are targets until a rehearsal runs. |
| Backups with an off-site copy | Partly closed | The backup job exists in `infra/backup/`. A restore rehearsal record is not yet available. |
| Dashboards and alerts | Closed in code | `infra/observability/`. You deploy and watch them. |
| Hardening guide | Open | Not yet available. |
| Encryption in transit between the migration job and the database | Open | The migration job and database scripts connect without TLS. Use them only on a private network. |
| Egress filtering of containers | Open | Compose cannot filter it. Use a host firewall rule or an egress proxy. |
| Helm chart | Open | Not yet available. Compose is the supported way to self-host. |
| Penetration test and Cyber Essentials Plus | Open | Not yet available. These belong to the compliance track. |
| External accessibility audit | Open | Booked for January 2027. See [accessibility results](accessibility-results.md). |
| Screen-reader checks | Open | Not yet recorded. |
| Wave of further tools (CRM, due diligence, forms, data protection, reporting) | Open | See the module pages. Most have no screens yet. |

## What you must do

- Treat every "open" row as a risk in your own risk register.
- Re-check this page against the release you deploy. The second edition of
  this pack will restate it.
