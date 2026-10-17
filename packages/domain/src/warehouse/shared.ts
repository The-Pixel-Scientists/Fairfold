// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shared warehouse tables (ADR 0016) that every module's rows join to.
// `organisation` and `person` come only from the party module. `programme`
// and `commitment` take rows from any module, with `source_module`; grants
// feeds both in MVP1. `date` is the platform's calendar. There is no
// `payment` table until a module pays.

import { column, nullable, sourceModule, type WarehouseTable } from './model.ts';

/** The dates that bound the `date` table, in the tenant's time zone. */
const commitmentDay = ['grants.decision.released_at', 'app.tenant.timezone'] as const;

const fiscalDay = [...commitmentDay, 'app.tenant.fiscal_year_start_month'] as const;

export const sharedTables = {
  organisation: {
    module: 'party',
    rows: 'Every organisation.',
    key: 'id',
    columns: {
      id: column('uuid', 'party.organisation.id'),
      status: column('text', 'party.party.status'),
      name: column('text', 'party.organisation.name'),
      legal_form: column('text', 'party.organisation.legal_form'),
      website: nullable('text', 'party.organisation.website'),
      // Its first identifier by scheme (GB-CHC, GB-SC, GB-NIC, GB-COH,
      // GB-MPR), as org-id.guide writes it: GB-CHC-1234567. Null if none.
      org_id: nullable(
        'text',
        'party.organisation_identifier.scheme',
        'party.organisation_identifier.identifier',
      ),
      // Whether staff verified that identifier. Null if none.
      org_id_verified: nullable(
        'boolean',
        'party.organisation_identifier.scheme',
        'party.organisation_identifier.verified_at',
      ),
      created_at: column('timestamptz', 'party.organisation.created_at'),
    },
  },
  person: {
    module: 'party',
    rows: 'Every person, applicants and staff alike, with no names or contact details.',
    key: 'id',
    columns: {
      id: column('uuid', 'party.person.id'),
      status: column('text', 'party.party.status'),
      created_at: column('timestamptz', 'party.person.created_at'),
    },
  },
  programme: {
    module: 'grants',
    rows: 'Every grants programme, whatever its status.',
    key: 'id',
    columns: {
      id: column('uuid', 'grants.programme.id'),
      source_module: sourceModule,
      title: column('text', 'grants.programme.title'),
      summary: column('text', 'grants.programme.summary'),
      status: column('text', 'grants.programme.status'),
      created_at: column('timestamptz', 'grants.programme.created_at'),
    },
  },
  commitment: {
    module: 'grants',
    rows: 'Released awards only: decisions accepted and released. Nothing from a decision before its release.',
    key: 'id',
    columns: {
      id: column('uuid', 'grants.decision.id'),
      source_module: sourceModule,
      programme_id: column('uuid', 'grants.round.programme_id'),
      organisation_id: column('uuid', 'grants.application.organisation_id'),
      amount_minor: column('bigint', 'grants.decision.amount_minor'),
      currency: column('text', 'grants.decision.currency'),
      // The day it was released, in the tenant's time zone.
      committed_on: column('date', ...commitmentDay),
    },
  },
  date: {
    module: 'platform',
    rows: "Every day from the first commitment's day to the last.",
    key: 'date',
    columns: {
      date: column('date', ...commitmentDay),
      year: column('integer', ...commitmentDay),
      quarter: column('integer', ...commitmentDay),
      month: column('integer', ...commitmentDay),
      // The calendar year in which its fiscal year starts, and its quarter of that fiscal year.
      fiscal_year: column('integer', ...fiscalDay),
      fiscal_quarter: column('integer', ...fiscalDay),
    },
  },
} as const satisfies Record<string, WarehouseTable>;
