// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the forms schema (migration 0079).

import type { SchemaCatalogue } from './index.ts';

const columns = (privilege: string, table: string, names: readonly string[]) =>
  names.map((name) => `${privilege} on column ${table}.${name}`);

const SUBMIT =
  'forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid)';
const CLEAN = 'EXECUTE on function forms.answers_are_clean(jsonb)';

export const forms: SchemaCatalogue = {
  executableBy: [
    // The check on every write of answers.
    ['forms.answers_are_clean(jsonb)', ['app_api']],
    // The one write path for anonymous responses (ADR 0036).
    [SUBMIT, ['app_api']],
    // The erasure job clears a subject's answers (ADR 0027).
    ['forms.erase_subject(uuid)', ['app_worker']],
  ],
  definerFunctions: [
    [
      // The one write path for anonymous responses; resolves the tenant from
      // the slug and sets none.
      SUBMIT,
      {
        owner: 'owner_forms_submit_public_response',
        // Never UPDATE or DELETE, and only the columns it and the triggers
        // it fires read or write.
        rights: [
          'USAGE on schema app',
          'USAGE on schema forms',
          'EXECUTE on function app.current_tenant_id()',
          CLEAN,
          ...columns('SELECT', 'app.tenant', ['id', 'slug', 'status']),
          ...columns('SELECT', 'app.tenant_module', ['tenant_id', 'module', 'enabled']),
          ...columns('SELECT', 'forms.form', [
            'tenant_id',
            'id',
            'respondents',
            'opens_at',
            'closes_at',
            'retention_months',
            'archived_at',
          ]),
          ...columns('SELECT', 'forms.form_version', [
            'tenant_id',
            'id',
            'form_id',
            'version',
            'status',
            'respondents',
          ]),
          ...columns('SELECT', 'forms.response', [
            'tenant_id',
            'id',
            'form_id',
            'route',
            'status',
            'retain_until',
            'idempotency_key_hash',
            'request_hash',
          ]),
          ...columns('INSERT', 'forms.response', [
            'tenant_id',
            'form_id',
            'form_version_id',
            'route',
            'status',
            'answers',
            'idempotency_key_hash',
            'request_hash',
            'proof_hash',
          ]),
          ...columns('INSERT', 'forms.respondent_token', [
            'tenant_id',
            'response_id',
            'token_hash',
          ]),
          ...columns('SELECT', 'app.retention_policy', ['tenant_id', 'policy', 'days']),
          // Never occurred_at, retain_until, actor_id or subject_party_id.
          ...columns('INSERT', 'app.audit_event', [
            'tenant_id',
            'request_id',
            'actor_kind',
            'action',
            'entity_type',
            'entity_id',
            'changes',
          ]),
        ],
        policies: [
          'app.tenant policy submit_public_response_select',
          'app.tenant_module policy submit_public_response_select',
          'app.retention_policy policy submit_public_response_select',
          'app.audit_event policy submit_public_response_insert',
          'forms.form policy submit_public_response_select',
          'forms.form_version policy submit_public_response_select',
          'forms.response policy submit_public_response_select',
          'forms.response policy submit_public_response_insert',
          'forms.respondent_token policy submit_public_response_insert',
        ],
      },
    ],
    [
      'forms.erase_subject(uuid)',
      {
        owner: 'owner_forms_erase_subject',
        // Never DELETE, nor any column that says who a response is about.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'USAGE on schema forms',
          'EXECUTE on function app.current_tenant_id()',
          CLEAN,
          ...columns('SELECT', 'party.party', ['tenant_id', 'id', 'status']),
          ...columns('SELECT', 'forms.form_version', ['tenant_id', 'id', 'definition']),
          ...columns('SELECT', 'forms.response', [
            'tenant_id',
            'id',
            'form_version_id',
            'respondent_person_id',
            'answers',
          ]),
          'UPDATE on column forms.response.answers',
        ],
        policies: [],
      },
    ],
  ],
};
