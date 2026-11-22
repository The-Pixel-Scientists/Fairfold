# Fairfold Due Diligence guides

Fairfold Due Diligence helps your team check an applicant before you fund
them. It looks up registers, screens names against the UK sanctions list,
points out records that look alike, holds your due diligence checklists and
keeps your monitoring visit records.

It advises. A named person decides every outcome. Nothing here rejects,
holds, blocks or pays an applicant, and no screen scores an application.

These guides are for grants officers, compliance leads and monitoring
officers. If you also run the servers, see the
[self-hosting quickstart](../../../docs/self-hosting/quickstart.md).

## Switch it on

Fairfold Due Diligence is off until an administrator switches it on. While it
is off, its screens are not found and nobody holds its permissions. See
[Modules](../../../docs/admin/modules.md) for the steps, and
[Team and roles](../../../docs/admin/team-and-roles.md) for giving people a
role.

The **Due diligence officer** role holds every permission below. The
**Programme manager** role holds only "View registry lookups and officers",
"View sanctions screening and match decisions" and "Record monitoring visits".

## Guides

| Guide                                         | What it covers                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| [Registry lookups](registry-lookups.md)       | What the registers tell you, how fresh it is and how to refresh it               |
| [Sanctions screening](sanctions-screening.md) | How screening works, and how to review a possible match and record your decision |
| [Duplicate flags](duplicate-flags.md)         | What a possible duplicate means, and what you can and cannot do with one         |
| [Checklists](checklists.md)                   | Building a checklist, publishing a new version and answering it                  |
| [Monitoring visits](monitoring-visits.md)     | Recording a visit, its follow-up and its evidence                                |

## Which permission each task needs

Permissions are named as the role catalogue names them.

| Task                                             | Permission                                       |
| ------------------------------------------------ | ------------------------------------------------ |
| Read an organisation's registry details          | View registry lookups and officers               |
| Refresh registry details                         | Refresh registry lookups                         |
| Link a registry officer to a person              | Link registry officers to people                 |
| Open the list of possible matches and read one | View sanctions screening and match decisions     |
| Start screening now                              | Run sanctions screening                          |
| Record a decision on a possible match            | Decide possible sanctions matches                |
| See possible duplicates                          | Review and dismiss duplicate application flags   |
| Create a checklist or publish a new version      | Set up due diligence checklists                  |
| Answer a checklist for an application            | Complete due diligence checklists                |
| Record and change monitoring visits              | Record monitoring visits                         |

"Decide possible sanctions matches" asks you to confirm your sign-in again
before it works. See [Sanctions screening](sanctions-screening.md).

## What is not in this release

- Checking reused bank details between applications.
- Politically exposed person and adverse-media checks.
- An offline app for visits.

## What the software does and what you do

The software records who did what and when, keeps registry copies and
decisions as dated records, and shows matches for a person to review. You are
responsible for your own sanctions, safeguarding and data protection
obligations. These guides describe the software. They are not legal advice.
