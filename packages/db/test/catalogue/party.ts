// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the party schema.

import type { SchemaCatalogue } from './index.ts';

const columns = (privilege: string, table: string, names: readonly string[]) =>
  names.map((name) => `${privilege} on column ${table}.${name}`);

const ADDRESS = [
  'address_line1',
  'address_line2',
  'address_town',
  'address_postcode',
  'address_country_code',
];
const PERSON = ['given_name', 'family_name', 'email', 'phone', 'user_id'];

export const party: SchemaCatalogue = {
  executableBy: [
    // Erasure runs as a job (ADR 0027).
    ['party.erase_party(uuid, uuid)', ['app_worker']],
    // The guards on an erased party's data call it as the writing role.
    ['party.is_erased(uuid, uuid)', ['app_api', 'app_worker']],
  ],
  definerFunctions: [
    [
      'party.erase_party(uuid, uuid)',
      {
        owner: 'owner_party_erase_party',
        // Never INSERT on occurred_at, retain_until or actor_member_kind,
        // which the database sets (ADR 0003, "Audit retention").
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          // The guards run as it while it clears the party's rows.
          'EXECUTE on function party.is_erased(uuid,uuid)',
          ...columns('SELECT', 'party.party', ['tenant_id', 'id', 'status', 'merged_into']),
          'UPDATE on column party.party.status',
          ...columns('SELECT', 'party.person', ['tenant_id', 'id', ...PERSON]),
          ...columns('UPDATE', 'party.person', PERSON),
          ...columns('SELECT', 'party.organisation', ['tenant_id', 'id', ...ADDRESS]),
          ...columns('UPDATE', 'party.organisation', ADDRESS),
          ...columns('SELECT', 'party.organisation_snapshot', ['tenant_id', 'organisation_id']),
          ...columns('UPDATE', 'party.organisation_snapshot', ADDRESS),
          ...columns('SELECT', 'party.value_history', [
            'tenant_id',
            'party_id',
            'field_id',
            'old_value',
            'new_value',
          ]),
          ...columns('UPDATE', 'party.value_history', ['old_value', 'new_value']),
          ...columns('SELECT', 'app.job_request', [
            'tenant_id',
            'id',
            'kind',
            'permission',
            'status',
            'filters',
            'requested_by',
            'request_id',
          ]),
          ...columns('SELECT', 'app.membership', ['tenant_id', 'id', 'user_id', 'status', 'roles']),
          ...columns('SELECT', 'app.retention_policy', ['tenant_id', 'policy', 'days']),
          ...columns('INSERT', 'app.audit_event', [
            'tenant_id',
            'request_id',
            'actor_kind',
            'actor_id',
            'action',
            'entity_type',
            'entity_id',
            'subject_party_id',
            'changes',
          ]),
        ],
        // The tenant policies, TO PUBLIC, admit it; the app roles' UPDATE
        // denials on snapshots and value history do not name it.
        policies: [],
      },
    ],
    [
      'party.is_erased(uuid, uuid)',
      {
        owner: 'owner_party_is_erased',
        // FOR KEY SHARE needs an UPDATE right; it updates nothing, and
        // set_updated_at would overwrite updated_at if it did.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          ...columns('SELECT', 'party.party', ['tenant_id', 'id', 'status']),
          'UPDATE on column party.party.updated_at',
        ],
        policies: [],
      },
    ],
  ],
};
