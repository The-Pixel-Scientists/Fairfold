# Data contracts

A data contract is a promise about what a tool adds to your warehouse. It
lists the tables and columns the tool may contribute, says how sensitive each
column is, and carries a version number. You can build reports on a contract
and know when it changes.

The warehouse is the copy of your data you download as the
[snapshot](loading-the-snapshot.md). Every contract adds tables to it, and
organisations and people are the shared keys that join them.

## How to read the contract pages

Members with the **Run and view reports** permission can open the data
contract pages in Fairfold Reporting. They list each tool and its contract
version, and for each table its columns, type, source and class ("Public" or
"Internal"). A tool whose contribution is not built yet shows no version.

The pages read the contracts, not your data.

## The rules every contract follows

- **Only public and internal columns.** A contract cannot hold a column
  classed as personal or special category data. The code refuses a contract
  that tries.
- **No names or contact details of people.** `person` holds an id and a
  status, with no name, email address or phone number.
- **Money is whole minor units with a currency code.** A column such as
  `amount_minor` holds pence for pounds. 1,250,000 with currency `GBP` is
  £12,500. Divide by 100 for pounds.
- **Released decisions only.** A decision is in the warehouse only once it has
  been released. Before then nothing about it is.
- **Programmes are `programme`.** The shared table is `programme`. In charity
  accounts a fund means restricted or unrestricted money, and nothing here
  holds that.

## Contracts in this release

Two tools fill their contract today: the people and organisations tool
(`party`) and the grants tool (`grants`). Other tools join as their
contributions are built.

### `party`, version 1

| Table | One row for | Columns |
| --- | --- | --- |
| `organisation` | Every organisation | `id`, `status`, `name`, `legal_form`, `website`, `org_id`, `org_id_verified`, `created_at` |
| `person` | Every person, with no names or contact details | `id`, `status`, `created_at` |

`org_id` is the organisation's first identifier as org-id.guide writes it,
such as `GB-CHC-0000001`, or empty if it has none. `org_id_verified` says
whether a member of staff verified it, and is empty if there is no
identifier. All of these columns are internal.

### `grants`, version 1

| Table | One row for | Columns |
| --- | --- | --- |
| `programme` | Every programme, whatever its status | `id`, `source_module`, `title`, `summary`, `status`, `created_at` |
| `commitment` | Every released award | `id`, `source_module`, `programme_id`, `organisation_id`, `amount_minor`, `currency`, `committed_on` |
| `grants_round` | Every round | `id`, `programme_id`, `title`, `opens_at`, `closes_at`, `budget_minor`, `award_min_minor`, `award_max_minor`, `currency`, `created_at` |
| `grants_application` | Every submitted or withdrawn application, without its answers | `id`, `round_id`, `organisation_id`, `applicant_person_id`, `status`, `submitted_at`, `submitted_late`, `withdrawn_at`, `outcome`, `commitment_id`, `created_at` |
| `grants_score` | Each criterion's score in a submitted review, without the reviewer's comment | `id`, `application_id`, `round_id`, `stage_id`, `assignment_id`, `criterion_id`, `criterion`, `weight`, `score`, `submitted_at` |

What the less obvious columns mean:

- `source_module` names the tool that fed the row, such as `grants`. It is
  internal. It lets other tools add rows to `programme` and `commitment`
  later.
- `committed_on` is the day the award was released, in your funder's time
  zone.
- `outcome` and `commitment_id` on `grants_application` are empty until the
  decision is released.
- `submitted_late` is true when the application came in after the deadline.
- `criterion` is the label of the scoring criterion, and `weight` its weight.
- On `programme`, `title` and `summary` are public. On `grants_round`, `title`,
  `opens_at`, `closes_at`, `award_min_minor`, `award_max_minor` and `currency`
  are public. Every other column is internal.

The platform also adds a `date` table, one row for each day from the first
award to the last, with year, quarter, month, and your financial year and
quarter. It belongs to no tool's contract.

## What never reaches the warehouse

- **Personal data:** names, email addresses, phone numbers and postal
  addresses of people and of organisations' contacts.
- **Special category data**, including equality monitoring answers and every
  figure counted from them. The contract rules refuse these whatever the
  settings. Monitoring figures exist only in the
  [monitoring reports](monitoring-reports.md), inside the console.
- **Unreleased decisions,** and anything about them.
- **Application tables as such.** The warehouse holds one row per application
  with its status and outcome. It does not hold what the applicant wrote,
  their budget, their files, reviewers' comments or drafts.
- **The audit log and your settings.**

Loading personal data into the warehouse is not part of this release. When it
is, it will be off unless you choose it.

Two things to judge for yourself. An organisation's name is in the warehouse,
so a sole trader named after themselves puts that name in. And
`applicant_person_id` and `person.id` give no name, but they link one person's
applications together.

## How a contract changes

Each contract has a version number. The version goes up when a change could
break something you built:

- a column or table is removed or renamed;
- a column's type, source or class changes.

Adding a column or table does not break a query that names its columns. The
software's tests check each published version for both kinds of change.

After an upgrade:

1. Open the data contract pages and note each version.
2. If a version went up, compare your queries and dashboards with the pages,
   and fix any that name a removed or renamed column.
3. Download a new snapshot. Its header records the warehouse model version it
   was built from.

The [starter dashboards](starter-dashboards.md) each name the model and
contract versions they target, and refuse to import into a warehouse made
from another model version.
