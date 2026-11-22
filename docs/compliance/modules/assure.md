# Due diligence

Due diligence covers checks on applicants and grantees: registry lookups,
sanctions screening, checklists and monitoring visits. Its screens are not
yet available. See the [module README](../../../modules/assure/README.md). No
guide has merged, so this page is written from the code and the
classification map as they stand on 19 November 2026.

## Personal data it holds

The classification map lists 14 `assure` tables, 9 with personal data and 5
internal. By purpose:

| Purpose | Data | Who it is about | Proposed basis |
| --- | --- | --- | --- |
| Due diligence | Checklists and responses, snapshots of registry lookups and the officers they name | Applicants, contacts, organisation officers | Legitimate interests |
| Sanctions screening | Screening runs, matches, the decisions on them, and reference lists | Applicants, contacts, officers, listed persons | Legal obligation |
| Grant monitoring | Monitoring visits, attendees and evidence | Applicants, contacts | Legitimate interests |

Retention rules in the map range from 90 days (a superseded list) to six
years (lookups and match decisions). Registry and sanctions data come from
third parties. The rules for using them are in
[ADR 0031](../../adr/0031-registry-lookups-and-sanctions-data.md), still
proposed.

## Controls beyond the platform baseline

- A screening match is a lead, and a named user records a decision on each
  one, so the software never rejects an applicant by itself.
- Outbound lookups go through the checked outbound dispatcher.
- Classification and erasure have database tests: `packages/db/test/assure/`.

## Row-level security and audit

- Cross-tenant denial tests for the tables are under `packages/db/test/assure/`.
- Audit coverage of real actions: not yet available. The server registers no
  routes yet.

## Open items

- Server routes, screens and a guide: not yet available.
- Live registry and sanctions feeds: not yet available.
