# Data Protection guides

These guides are for the person at a funder who answers data protection
requests, records breaches, writes impact assessments and keeps records of
processing. If you host the software yourself, the operator tasks are in the
[self-hosting quickstart](../../../docs/self-hosting/quickstart.md).

The tool is called Data Protection in the console. It helps you do these jobs
and keeps a record of them. It does not give legal advice. Where a guide states
a legal rule, it names the article or act. Confirm the rule with your own data
protection adviser.

## Who can do what

Each task needs a permission. Today only the **Administrator** role holds all
six. See [Team and roles](../../../docs/admin/team-and-roles.md).

| Task | Permission |
| --- | --- |
| Log, track and close requests; read consent history | `privacy.requests.manage` |
| Export a person's data | `privacy.requests.export` (asks you to confirm it is you) |
| Erase a person's data | `privacy.requests.erase` (asks you to confirm it is you) |
| Record breaches | `privacy.breaches.manage` |
| Write impact assessments | `privacy.dpias.manage` |
| Keep records of processing | `privacy.processing.manage` |

## What the tool does not do yet

- A person cannot send a request through the applicant portal. You log each
  request by hand.
- It does not set statutory retention periods. Every privacy record is kept
  for the life of your funder's account.
- It does not send reminders about request deadlines, breach deadlines or
  impact assessment reviews. Check the lists every working day. The requests
  list shows the soonest due date first.
- It never sends anything to the ICO or to a person. You record that you told
  them.
- Nothing is exported or erased without a named person choosing to do it.

## The guides

| Guide | Use it to | UK GDPR articles |
| --- | --- | --- |
| [Rights requests and deadlines](rights-requests.md) | Log a request, watch the clock, set tasks and close it | 12, 15 to 22 |
| [Export and erase a person's data](export-and-erasure.md) | Answer an access, portability or erasure request | 15, 17, 20 |
| [Personal data breaches](breaches.md) | Record a breach, assess it and record who was told | 33, 34 |
| [Impact assessments](dpias.md) | Screen, assess and sign off a DPIA | 35 |
| [DPIA template](templates/dpia.md) | Copy a plain template for your own records | 35 |
| [Records of processing](records-of-processing.md) | Read the generated record and add activities and processors | 30 |
| [Consent history](consent-audit.md) | See every consent choice a person made | 7, 15 |

Each guide describes the console as it is today. If a screen or button here
differs from what you see, tell the operator.
