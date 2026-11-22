// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the grants schema.

import type { SchemaCatalogue } from './index.ts';

export const grants: SchemaCatalogue = {
  // They follow party.erase_party in the erasure job (ADR 0027).
  executableBy: [
    ['grants.clear_answer_fields(uuid, text[])', ['app_worker']],
    ['grants.erase_reminders(uuid)', ['app_worker']],
    // Public fields of a tenant's open rounds by slug, with no tenant set (ADR 0035).
    ['grants.public_open_rounds(text)', ['app_api']],
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
    [
      'grants.public_open_rounds(text)',
      {
        owner: 'owner_grants_public_open_rounds',
        // Read only, and never a round's budget or late policy, a programme's
        // description, or a form version's id or publisher.
        rights: [
          'USAGE on schema app',
          'USAGE on schema grants',
          ...['id', 'slug', 'status'].map((column) => `SELECT on column app.tenant.${column}`),
          ...['tenant_id', 'module', 'enabled'].map(
            (column) => `SELECT on column app.tenant_module.${column}`,
          ),
          ...['tenant_id', 'id', 'title', 'summary', 'status'].map(
            (column) => `SELECT on column grants.programme.${column}`,
          ),
          ...[
            'tenant_id',
            'id',
            'programme_id',
            'title',
            'opens_at',
            'closes_at',
            'timezone',
            'award_min_minor',
            'award_max_minor',
            'currency',
          ].map((column) => `SELECT on column grants.round.${column}`),
          ...['tenant_id', 'round_id', 'version', 'status', 'definition'].map(
            (column) => `SELECT on column grants.form_version.${column}`,
          ),
        ],
        policies: [
          'app.tenant',
          'app.tenant_module',
          'grants.programme',
          'grants.round',
          'grants.form_version',
        ].map((table) => `${table} policy public_open_rounds_select`),
      },
    ],
  ],
};
