// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the grants schema.

import type { SchemaCatalogue } from './index.ts';

export const grants: SchemaCatalogue = {
  // They follow party.erase_party in the erasure job (ADR 0027).
  executableBy: [
    ['grants.clear_answer_fields(uuid, text[])', ['app_worker']],
    ['grants.erase_reminders(uuid)', ['app_worker']],
  ],
  definerFunctions: [
    [
      'grants.clear_answer_fields(uuid, text[])',
      {
        owner: 'owner_grants_clear_answer_fields',
        rights: [
          'USAGE on schema app',
          'USAGE on schema grants',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'applicant_person_id', 'answers'].map(
            (column) => `SELECT on column grants.application.${column}`,
          ),
          'UPDATE on column grants.application.answers',
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
        ],
        policies: [],
      },
    ],
    [
      'grants.erase_reminders(uuid)',
      {
        owner: 'owner_grants_erase_reminders',
        // Never DELETE, and of a reminder only the recipient it clears.
        rights: [
          'USAGE on schema app',
          'USAGE on schema grants',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
          ...['tenant_id', 'recipient_person_id'].map(
            (column) => `SELECT on column grants.reminder_email.${column}`,
          ),
          'UPDATE on column grants.reminder_email.recipient_person_id',
        ],
        policies: [],
      },
    ],
  ],
};
