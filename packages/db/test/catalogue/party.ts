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
    // The public unsubscribe route alone calls it (ADR 0033).
    ['party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)', ['app_api']],
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
          // The ledger trigger runs as it (migration 0047); never erased_at.
          ...columns('INSERT', 'app.erasure_ledger', [
            'tenant_id',
            'subject_party_id',
            'kind',
            'subject_key_id',
            'audit_event_id',
          ]),
          // A ledger row is its authority in restore mode (migration 0049).
          ...columns('SELECT', 'app.restore_mode', ['active', 'request_id']),
          ...columns('SELECT', 'app.erasure_ledger', ['tenant_id', 'subject_party_id', 'kind']),
        ],
        // The tenant policies, TO PUBLIC, admit it; the app roles' UPDATE
        // denials on snapshots and value history do not name it.
        policies: ['app.restore_mode policy restore_mode_select'],
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
    [
      'party.record_unsubscribe(uuid, uuid, text, text, bytea, integer, uuid)',
      {
        owner: 'owner_party_record_unsubscribe',
        // No tenant is set, so its policies are what admit it. The lock
        // clause needs an UPDATE right, and the UPDATE policy admits no new
        // row. Never INSERT on recorded_at, recorded_by, occurred_at,
        // retain_until or actor_member_kind.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          // The erased-party guards on consent and suppressions run as it.
          'EXECUTE on function party.is_erased(uuid,uuid)',
          ...columns('SELECT', 'app.tenant', ['id', 'status']),
          ...columns('SELECT', 'party.person', ['tenant_id', 'id']),
          ...columns('SELECT', 'party.party', ['tenant_id', 'id', 'kind', 'status']),
          'UPDATE on column party.party.updated_at',
          ...columns('SELECT', 'party.consent', [
            'tenant_id',
            'person_id',
            'purpose',
            'channel',
            'state',
            'privacy_notice_version',
            'recorded_at',
          ]),
          ...columns('INSERT', 'party.consent', [
            'tenant_id',
            'id',
            'person_id',
            'purpose',
            'channel',
            'state',
            'privacy_notice_version',
            'source',
          ]),
          ...columns('SELECT', 'party.suppression', [
            'tenant_id',
            'person_id',
            'channel',
            'purpose',
            'reason',
            'address_hash',
          ]),
          ...columns('INSERT', 'party.suppression', [
            'tenant_id',
            'id',
            'person_id',
            'channel',
            'purpose',
            'reason',
            'source',
            'address_hash',
            'hash_key_version',
          ]),
          ...columns('SELECT', 'app.retention_policy', ['tenant_id', 'policy', 'days']),
          ...columns('INSERT', 'app.audit_event', [
            'tenant_id',
            'request_id',
            'actor_kind',
            'action',
            'entity_type',
            'entity_id',
            'subject_party_id',
            'changes',
          ]),
        ],
        policies: [
          'app.tenant policy record_unsubscribe_select',
          'party.person policy record_unsubscribe_select',
          'party.party policy record_unsubscribe_select',
          'party.party policy record_unsubscribe_lock',
          'party.consent policy record_unsubscribe_select',
          'party.consent policy record_unsubscribe_insert',
          'party.suppression policy record_unsubscribe_select',
          'party.suppression policy record_unsubscribe_insert',
          'app.retention_policy policy record_unsubscribe_select',
          'app.audit_event policy record_unsubscribe_insert',
        ],
      },
    ],
  ],
};
