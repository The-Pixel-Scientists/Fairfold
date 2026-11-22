# What reaches the warehouse

The warehouse is the shared store the tools feed so a funder can report across
them. This page says what CRM sends it.

## Today: nothing

CRM has no data contract yet. In the platform's list of data contracts, the
slot for CRM is empty (`dataContracts.crm` in
`packages/domain/src/warehouse/registry.ts` is `null`), and CRM has no
contribution in its server code. So CRM adds no table and no column to the
warehouse, and a warehouse load that names CRM is refused. This page lists no
columns because there are none to list.

When CRM gets a contract, this page will list each warehouse table CRM
contributes to, with every column, its type, its source table and column, its
classification, and the data-contract version.

## What you can report on today

CRM reads the shared record of organisations and people, which the shared
record's own data contract feeds to the warehouse. That contract carries these
columns and no others:

| Warehouse table | Columns |
| --- | --- |
| `organisation` | `id`, `status`, `name`, `legal_form`, `website`, `org_id`, `org_id_verified`, `created_at` |
| `person` | `id`, `status`, `created_at` |

Every column is classified Internal. To join other tools' tables to these, use
the organisation or person id. The grants tables, for example, carry an
`organisation_id` and an `applicant_person_id`.

What the shared record's contract holds, and how to load it, is in the
[warehouse snapshot guide](../../../docs/self-hosting/warehouse-snapshot.md).

## What can never reach the warehouse

A data contract can publish only columns classified Public or Internal. It
cannot express Personal or Special category data at all. For CRM that means
these stay out:

- A person's name, email address and phone number, and an organisation's
  contacts.
- Staff's interaction summaries.
- Import rows, which hold the cells from your files, and import jobs.
- External ids and links to other systems.
- Who merged what (the merge record's member).
- A list's or segment's name and description, which are configuration.

## How you can check this

- The classification of every CRM table and column, with its retention rule:
  `packages/db/classification/crm.ts`. It covers `crm.list`,
  `crm.list_member`, `crm.segment`, `crm.interaction`, `crm.merge_record`,
  `crm.import_job`, `crm.import_row` and `crm.external_reference`.
- The slot: `dataContracts.crm` in `packages/domain/src/warehouse/registry.ts`.
- The shared record's contract: `partyContract` in the same file.

Only the snapshot feed is planned for the first version of CRM. A feed that
updates as records change comes later.
