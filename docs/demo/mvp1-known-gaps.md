# What the first release leaves out

The first release is a whole funding round on synthetic data, run on a laptop
with `pnpm stack`. It is pre-release software and holds no real personal data.
This page lists what it leaves out, in plain words, so nobody mistakes it for
finished.

Everything here is debt. **Fix the faults and clear the staging list before
anyone real uses a staging site, and clear every list before the first
compliance gate** (the penetration test, Cyber Essentials Plus, the data
protection impact assessment, data processing agreements and the audits). The
release was brought forward to the end of October 2026, and the things below
were cut or left to make that date.

## Faults found while checking the demo

These work wrongly today. Each has a way round for the demo, and each needs a
fix.

- **The audit log cannot read back a stylesheet change.** Saving a funder
  stylesheet records an event the log's page cannot show. A page of the log
  that holds it fails with an error, so the unfiltered log may not open. The
  demo opens the log filtered to Grants, which avoids it. A test in the
  journey is marked as an expected failure and starts failing the day this is
  fixed.
- **The API's description of itself does not load.** `/openapi.json` answers
  with an error once the modules' routes are registered. Nothing in the demo
  uses it. A test is marked as an expected failure for it too.
- **An administrator cannot choose a round for the 360Giving file.** Choosing
  what to download needs the Programme manager role as well as the
  Administrator role, and the seeded administrator has only the first. The
  route itself needs only the export permission. The demo gets round it by
  inviting a colleague who has both roles.
- **The round page does not link to the application form.** The form builder
  is reached by its address, `/rounds/<round id>/form`. The reviewers and score
  spread pages are reached from Submissions, and the decisions page from a
  submission.
- **`pnpm tenant:create` does not reach the stack.** It works on the database
  that `pnpm dev` uses. The stack's database is on a network only its
  containers can reach, so a funder in the stack comes from `pnpm stack seed`.
- **Setting up an authenticator app has no QR code.** The set-up key is shown
  as text to type in, and a link opens the app on the same device.
- **Only one machine type has been tried.** Every command in the quickstart and
  the demo ran from Git Bash on Windows 11. Linux and macOS have not been tried.

## Clear before anyone real uses staging

### Sign-in and accounts

- Signing in with a passkey, or through a funder's own provider (OpenID Connect
  and SAML single sign-on).
- Backup codes. Lose the authenticator app and the account is locked.
- Changing the email address on an account.
- A check of new passwords against known breaches. A list of common passwords
  is built in, but nothing is checked online, because that needs the platform
  to make outbound requests, which it does not yet.
- Device cookies for the sign-in rate limits, and an authenticator app offered
  to applicants. Today only staff and reviewers need a code.
- A command that replays audit events from the copy kept in the auth schema,
  and its alert.
- A command that re-encrypts stored secrets when a key changes.
- A runbook for deactivating an account.
- Rate limits on the public and sign-in routes, before the API faces the
  internet.
- A second, unhurried security pass over sign-in and row-level security,
  planned for the first week of November.

### Running it

- **Staging.** There is no staging site. The managed-service set-up on Google
  Cloud, the backup and hosting-target decisions (ADRs 0011, 0012 and 0015) and
  a way to run the database scripts against a managed database that gives no
  superuser are all still to do.
- **Encryption in transit.** The stack serves plain HTTP, and the migration job
  and database scripts connect to the database without TLS. They are safe only
  on the stack's own private network. Do not point them at a database server
  anywhere else.
- **Backups, runbooks, dashboards and the off-site copy** for the managed
  service. The stack has none.
- **Guides:** an administrator's guide, a hardening guide, and an upgrade path
  (there are no release versions yet).
- **Egress.** Compose cannot filter what leaves a container. A host firewall
  rule or egress proxy is needed.
- **A background worker.** There is none. Release emails go from the API through
  an outbox table. Reminders, the incremental warehouse feed and moving release
  emails off the request all wait for the worker (the job queue, pg-boss).
- **Health checks inside the images** for hosts other than Compose.

### Files

Uploads are scanned by ClamAV inside the request and stored only when clean.
Still to do:

- a reverse proxy in front of the API;
- upload rate limits;
- rescanning stored files as the virus signatures update;
- a sweep that removes withdrawn and refused files and orphaned objects;
- erasing the content of a file;
- uploads straight to storage for files larger than 10 MB.

## Clear before the first compliance gate

### Data protection

- **Retention.** Nothing is purged when its retention time passes.
- **Subject access and erasure.** There is no way yet to find and export
  everything about a person, or to erase it. This needs a decision on erasing
  audit data. The audit events will carry a data subject so that a person's
  events can be found in every module.
- **Classification by subject.** Each classified table should record which
  person or organisation a row is about, so subject access, erasure and export
  are generated from the map across modules.
- **Form answers.** One column holds all of an application's answers, mixing
  internal and personal values. Each answer needs its own classification from
  the pinned form version.
- **The submission snapshot.** An application points to the organisation's
  current details, not to a snapshot of what they were at submission. A copy at
  submission time is needed.
- **Personal data in the warehouse.** The snapshot holds none. A funder
  switching it on needs guidance on erasure in downstream copies first, and
  that option is off by default.
- **Idempotency keys** on routes that create things, so a retried request does
  not create two.
- **Publishing the plugin exception** to the licence (AGPL section 7), before
  the first outside contribution. Code contributed before then is not covered.

### Data out

- **360Giving.** The file is checked against our own description of the
  standard's fields, not the official schema. The grant title is the round's
  title and the description is the programme's summary, so no applicant text is
  published. Recipient identifiers are the ones applicants typed, and nobody has
  verified them: the export lists them. Publishing only verified identifiers
  waits for staff to verify them.
- **Exports run inside the request** and are capped. The warehouse snapshot is
  limited to 50 MB. Larger ones need a job.
- **CSV export, board packs, scheduled and incremental feeds, and a live
  BigQuery feed** are not built. The snapshot is the only way to the warehouse.

### Grants features

- Messaging between funder and applicant, notes, saved views, owners and
  labels on applications.
- Reminders, and a test send of the outcome emails.
- Exporting and importing a programme's configuration as a file.
- Browsing programmes before signing in. Applicants must have an account first.
- Audit log search, and export of the log.
- Per-funder classification of fields.
- Full custom CSS for the portal. The stylesheet changes design values only
  (see the [funder stylesheet guide](../self-hosting/funder-stylesheet.md)).
  Only two fonts are allowed, and each further font needs its licence checked.

### Quality and assurance

- A manual accessibility audit, and an external one. Automated axe checks run
  on every page the demo visits, which is not enough to claim WCAG 2.2 AA.
- A screen reader check by hand (NVDA on Windows, VoiceOver on macOS).
  Moving to a new page moves focus to its heading and also announces the page
  title, which may be read twice.
- Journeys in Firefox and Safari. The end-to-end journeys run in Chromium only.
- Acceptance in a staging site, and a second engineer's approval, which the
  definition of done for the first version asks for. The release has neither.
- The penetration test, Cyber Essentials Plus, the data protection impact
  assessment, data processing agreements and the audits. These run as a
  separate track.

## What the release is

The release proves that one funding round runs end to end, that each funder's
data stays apart, and that the data can leave. It does not prove that it is
ready for real people's data. Where this page and the quickstart disagree about
what is safe to do, believe the quickstart: do not put live personal data in the
stack.
