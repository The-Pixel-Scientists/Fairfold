# Respond to a security incident

Use this page when something may have exposed data, let someone in who should
not be in, or stopped the service. It covers the managed service and a
self-hosted install. It gives the engineering route, including the 72-hour
route to the Information Commissioner's Office (ICO). The service company's
incident policy, and who speaks to the ICO, are for the company to decide.

## When to use this

Start here when an alert names this page, when someone reports a problem, or
when you suspect one. If in doubt, treat it as an incident and downgrade it
later. The alerts that name this page are `JobFailuresHigh`,
`QueueDepthHigh`, `ServerErrorsHigh`, `LatencyHigh` and `RateLimitHitsHigh`
in `infra/observability/alerts/tps.rules.yaml`.

Pick a severity. Raise it if you are unsure.

| Severity | Examples | First response |
| --- | --- | --- |
| 1: critical | Suspected cross-tenant exposure. A leaked secret or key. Ransomware or data loss. A compromised operator account. | Call the incident lead now. Contain within the hour. |
| 2: high | A compromised staff or applicant account. The service is down for everyone. An audit copy is stuck and the cause is unknown. | Start within 30 minutes. |
| 3: moderate | One tenant unavailable. A rate-limit alert that looks like an attack. Repeated dead-lettered jobs. | Start the same working day. |
| 4: low | A vulnerability reported with no sign of use. | Follow [the security policy](../../SECURITY.md) and fix on its timetable. |

Someone outside the team who reports a vulnerability follows the security
policy. It promises an acknowledgement within 3 working days.

## Before you start

- You are a platform operator with access to the logs, the database settings
  and the dashboards. Self-hosters: whoever runs the install.
- You have an incident record outside the database: a shared document or
  ticket that only the responders can read.
- You know the incident lead and the data protection contact. For the managed
  service these roles are to be named: incident lead, data protection contact
  and solicitor.
- You have the dashboards Security events, Requests and Jobs open. They are in
  `infra/observability/dashboards/`.

The software provides these controls: every sign-in, second-factor and
account event is written to an append-only audit table; tenant data is
isolated by row-level security; logs and job errors carry codes and ids, not
answers or addresses. The operator provides the rest: on-call cover, the
escrow of keys, backups, the incident policy, the legal route to the ICO and
the evidence kept outside the database.

## Steps

### First hour

1. **Write down the time you became aware.** Use UTC and a full date, for
   example "18 November 2026, 14:05". The 72 hours start here.
2. **Name an incident lead and a note-taker.** Start the timeline table below
   in the record.
3. **Contain.** Stop the harm without destroying evidence.
   - Leaked secret or key: follow
     [Rotate the auth secret and other secrets](secret-rotation.md).
   - Compromised staff account: follow
     [Deactivate an account](deactivation.md). Do not delete the account.
   - Attack on sign-in: follow [Help a locked-out person](lockout.md) and
     tighten the proxy in front of the API. Do not turn off a rate limit.
   - Ransomware or data loss: cut the servers off from the network first. Then
     follow [Restore the service from a backup](restore.md).
4. **Preserve evidence.** Keep the logs. Do not rebuild a server you may need
   to examine unless the service must come back. Note the software version and
   the container image or Cloud Run revision. Never edit or delete an audit
   row. The application cannot, and you must not try another way.
5. **Tell the people who must know.** Tell the incident lead and the data
   protection contact now. Tell each affected funder as set out below.

### Find out what happened without copying personal data

6. **Read the auth events in place.** Sign-in failures, second-factor
   failures, resets, session revocations and audit-copy replays are in the
   `auth` audit table, and the platform copies each one to the audit log of the
   funder the person belongs to. Auth events hold client addresses and typed
   identifiers for 12 months. Read them where they are and do not copy them
   out. Write down event ids, codes (such as `sign_in_failed` or
   `mfa_code_failed`), times and counts.
7. **Read the funder's audit log.** The funder's administrator can read it
   under **Audit log** ([Audit log guide](../admin/audit-log.md)). Record event
   ids and actions, not names or applicant answers.
8. **Read the application logs.** The API writes one JSON line per request,
   with ids and codes. Managed service: use the Cloud Run logs for the API and
   the worker (see the Google Cloud section below). Self-hosted: run
   `pnpm stack logs api` and `pnpm stack logs worker`. Search by request id or
   error code. Do not paste lines that hold personal data into the record.
9. **Check the cell's health.** On the Security events dashboard, look at
   sign-in failures, second-factor failures and rate-limit hits. On the Jobs
   dashboard, look at failures and dead-lettered jobs. Check that
   [the audit copy](audit-copy.md) has nothing pending, because a stuck copy
   hides events from funders' audit logs.

### Decide whether it is a personal data breach

10. **Answer three questions in the record.**
    - Was personal data destroyed, lost, changed, or shown or given to someone
      who should not have it?
    - Whose data, in which funders, and roughly how many people?
    - What could happen to those people? Think of fraud, distress, a lost
      grant or the exposure of sensitive information.
11. **If the answer to the first question is yes, it is a personal data
    breach.** If you cannot say yet, treat it as one and keep investigating.
    A report can be made in phases.

### Tell the funder, the ICO and the people affected

For the managed service, each funder is the controller of its applicants' and
staff data, and the service company is the processor. For platform staff
accounts and the company's own data, the service company may be the
controller. Who notifies in each case is **to be decided** by the service
company and its solicitor. A self-hosted install is usually its own
controller.

12. **Processor to controller.** The service company must tell each affected
    funder without undue delay after it becomes aware (UK GDPR Article 33(2)).
    Send ids, the funder, times, what is known, what is not and what you are
    doing. Send no personal data. Note the time you told them.
13. **Controller to the ICO.** The controller must report a breach to the ICO
    within 72 hours of becoming aware of it (UK GDPR Article 33(1)), unless it
    is unlikely to risk people's rights and freedoms. The 72 hours include
    weekends and bank holidays. Use the ICO's own route for reporting a
    personal data breach. If you lack some details, report what you have and
    give the rest in phases, with the reasons for the delay. If the controller
    decides not to report, it writes down why.
14. **Controller to the people affected.** If the breach is likely to put
    people at high risk, the controller must tell them without undue delay
    (UK GDPR Article 34). Use plain language: what happened, who to contact,
    the likely effect and what is being done. The platform sends no such
    notice. The controller sends it.
15. **Keep the breach record.** Whether or not it is reported, the controller
    records the facts, the effects and the action taken (UK GDPR Article
    33(5)). The platform has no breach log screen yet, so this is a document
    outside the database.

### Timeline table

Keep this table in the record and fill it in as you go.

| Time (UTC) | What happened or was decided | Who | Evidence (ids and codes only) |
| --- | --- | --- | --- |
| Time we became aware | | | |
| | Incident lead named | | |
| | Contained | | |
| | Funders told | | |
| | Controller's decision on the ICO | | |
| | Reported to the ICO, or why not | | |
| | People told, or why not | | |
| | Service restored | | |
| | Closed, with follow-up actions | | |

### After the incident

16. **Review within 5 working days.** Write what went well, what did not and
    each follow-up action with an owner. Rotate any secret that may have been
    seen. Check that the alerts fired when they should have.

### Managed service on Google Cloud

- Read logs in Cloud Logging, filtered to the API and worker Cloud Run
  services of the cell (for example `tps-staging-uk` in `europe-west2`).
- Cloud Run keeps each deployed revision. Note the revision name in the record
  before you deploy a new one.
- Cloud Audit Logs show who changed the project. Check them if you suspect an
  operator account.

## Check it worked

- The record has a time we became aware, an incident lead, a severity and a
  timeline with no gap longer than an hour.
- Every affected funder has been told, with the time noted.
- The controller has decided about the ICO and the people affected, and the
  reasons are written down.
- No alert from the rules file is firing, the audit copy has nothing pending,
  and no job is dead-lettered without a known reason.
- The record holds no applicant answers, email addresses, IP addresses or
  tokens.

## If something goes wrong

- You cannot reach the incident lead: go to the next person on the contact
  list and write down each attempt and its time.
- You cannot tell whether data was exposed: treat it as exposed until you can
  show it was not.
- The audit log is missing events: see [the audit copy](audit-copy.md). Events
  that keep failing to copy are part of the incident.
- You need a restore: follow [Restore the service from a backup](restore.md).
  First copy what you need from the affected system into protected storage.
- You are tempted to change data in the database to tidy up: do not. Raise it
  with the incident lead.

## Record

Keep the record in an access-controlled place outside the database. Write:

- the severity, the time we became aware and the people involved;
- what you saw: alert names, dashboards, event ids, error codes, request ids;
- what you did, in order, with times;
- the three breach questions and their answers;
- when each funder was told, and when the ICO and the people affected were
  told, or why they were not;
- the review and its actions.

Never write applicant answers, email addresses, IP addresses, user ids,
tokens or secrets in the record.

The software writes an audit event for the changes it makes, such as
membership changes, session revocations, secret re-encryption and audit-copy
replays. Your own record covers everything else.

## Tabletop exercise

Run this once before go-live and every 6 months after. It takes 60 minutes.
Use synthetic data only.

1. Gather the incident lead, one operator, the data protection contact and a
   note-taker.
2. Read this scenario aloud. At 17:40 on a Friday, a funder tells you that an
   applicant saw another funder's name on their application page. The
   Security events dashboard is quiet.
3. Ask the group to work through this page: the severity, the time we became
   aware, the first containment step, where they would look in the audit log
   and the logs, and who they would tell.
4. At 40 minutes, add a twist: the logs show one operator account read data
   from two funders in one hour. Ask what changes.
5. Ask the controller's representative to decide, with reasons, whether to
   report to the ICO, and when the 72 hours end.
6. Fill in the timeline table as if it were real.
7. Finish by listing what was unclear on this page, and fix it.

Keep the exercise record: the date, who took part, the scenario, the
decisions and times, the gaps found and the actions with owners. File it with
the incident records. It is the Gate 1 evidence for the incident response
plan.
