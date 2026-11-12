// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the crm schema (migration 0063).

import type { SchemaCatalogue } from './index.ts';

const columns = (privilege: string, table: string, names: readonly string[]) =>
  names.map((name) => `${privilege} on column ${table}.${name}`);

export const crm: SchemaCatalogue = {
  executableBy: [
    // The erasure job clears a subject's crm data (ADR 0027).
    ['crm.erase_subject(uuid)', ['app_worker']],
  ],
  definerFunctions: [
    [
      'crm.erase_subject(uuid)',
      {
        owner: 'owner_crm_erase_subject',
        // Never DELETE, nor any column that says who a row is about.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'USAGE on schema crm',
          'EXECUTE on function app.current_tenant_id()',
          ...columns('SELECT', 'party.party', ['tenant_id', 'id', 'status']),
          ...columns('SELECT', 'crm.interaction', ['tenant_id', 'party_id', 'summary']),
          'UPDATE on column crm.interaction.summary',
          ...columns('SELECT', 'crm.import_row', [
            'tenant_id',
            'created_party_id',
            'duplicate_party_id',
            'cells',
          ]),
          'UPDATE on column crm.import_row.cells',
          ...columns('SELECT', 'crm.external_reference', [
            'tenant_id',
            'id',
            'party_id',
            'external_id',
            'url',
          ]),
          ...columns('UPDATE', 'crm.external_reference', ['external_id', 'url']),
        ],
        policies: [],
      },
    ],
  ],
};
