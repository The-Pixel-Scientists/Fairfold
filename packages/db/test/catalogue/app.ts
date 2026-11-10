// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the app schema.

import { RIGHTS_ROLES } from '../connect.ts';
import type { SchemaCatalogue } from './index.ts';

/**
 * app.current_tenant_id() as pg_get_functiondef prints it with search_path
 * set to pg_catalog alone (ADR 0003, row-level security rule 5).
 */
export const CURRENT_TENANT_ID_DEFINITION = `CREATE OR REPLACE FUNCTION app.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE PARALLEL SAFE
RETURN (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid
`;

export const app: SchemaCatalogue = {
  executableBy: [
    // Every tenant policy calls it, whichever role runs the query.
    ['app.current_tenant_id()', RIGHTS_ROLES],
    // Public tenant pages and sign-in, with no tenant set (ADR 0019).
    ['app.public_tenant(text)', ['app_api', 'app_auth']],
    ['app.public_tenant_logo(text)', ['app_api']],
    // The operator command alone (ADR 0019).
    ['app.create_tenant(text, text)', ['app_worker']],
    // The bounded purges of expired keys and counters (ADR 0028).
    ['app.delete_expired_idempotency_keys(integer)', ['app_worker']],
    ['app.delete_expired_request_limits(integer)', ['app_worker']],
    // The worker's per-tenant fan-out (ADR 0009).
    ['app.tenant_ids()', ['app_worker']],
    // The audit retention purge (ADR 0003), per tenant and once with none set.
    ['app.purge_expired_audit()', ['app_worker']],
    // Every other retention policy, per tenant (ADR 0003).
    ['app.apply_retention(text)', ['app_worker']],
    // The erasure job, once the party is erased (ADR 0027).
    ['app.destroy_subject_key(uuid)', ['app_worker']],
    // A restore's one-off worker process, in restore mode alone (ADR 0011).
    ['app.reapply_erasure_ledger()', ['app_worker']],
    // A join table's triggers link and release a file (ADR 0030).
    ['app.link_file(uuid)', ['app_api']],
    ['app.release_file(uuid)', ['app_api']],
    // The file sweep and file erasure (ADR 0030).
    ['app.delete_swept_file(uuid)', ['app_worker']],
    ['app.erase_file(uuid, uuid)', ['app_worker']],
    // The erasure job clears a subject's notes and messages (ADR 0027).
    ['app.erase_subject_notes(uuid)', ['app_worker']],
  ],
  definerFunctions: [
    [
      'app.public_tenant(text)',
      {
        owner: 'owner_app_public_tenant',
        rights: [
          'USAGE on schema app',
          ...['id', 'slug', 'name', 'status'].map(
            (column) => `SELECT on column app.tenant.${column}`,
          ),
          ...['tenant_id', 'brand_colour', 'preset', 'logo_type', 'tokens'].map(
            (column) => `SELECT on column app.tenant_theme.${column}`,
          ),
        ],
        policies: [
          'app.tenant policy public_tenant_select',
          'app.tenant_theme policy public_tenant_select',
        ],
      },
    ],
    [
      'app.public_tenant_logo(text)',
      {
        owner: 'owner_app_public_tenant_logo',
        rights: [
          'USAGE on schema app',
          ...['id', 'slug', 'status'].map((column) => `SELECT on column app.tenant.${column}`),
          ...['tenant_id', 'logo', 'logo_type'].map(
            (column) => `SELECT on column app.tenant_theme.${column}`,
          ),
        ],
        policies: [
          'app.tenant policy public_tenant_logo_select',
          'app.tenant_theme policy public_tenant_logo_select',
        ],
      },
    ],
    [
      'app.create_tenant(text, text)',
      {
        owner: 'owner_app_create_tenant',
        rights: [
          'USAGE on schema app',
          ...['id', 'slug', 'name'].map((column) => `INSERT on column app.tenant.${column}`),
        ],
        policies: ['app.tenant policy create_tenant_insert'],
      },
    ],
    [
      'app.tenant_ids()',
      {
        owner: 'owner_app_tenant_ids',
        rights: [
          'USAGE on schema app',
          ...['id', 'status'].map((column) => `SELECT on column app.tenant.${column}`),
        ],
        policies: ['app.tenant policy tenant_ids_select'],
      },
    ],
    [
      'app.purge_expired_audit()',
      {
        owner: 'owner_app_purge_expired_audit',
        // Never INSERT on occurred_at, retain_until or actor_member_kind,
        // which the database sets (ADR 0003, "Audit retention").
        rights: [
          'USAGE on schema app',
          'USAGE on schema auth',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'policy', 'days'].map(
            (column) => `SELECT on column app.retention_policy.${column}`,
          ),
          'DELETE on app.audit_event',
          ...['id', 'tenant_id', 'retain_until'].map(
            (column) => `SELECT on column app.audit_event.${column}`,
          ),
          ...[
            'tenant_id',
            'request_id',
            'actor_kind',
            'action',
            'entity_type',
            'entity_id',
            'changes',
          ].map((column) => `INSERT on column app.audit_event.${column}`),
          'DELETE on auth.audit_event',
          ...['id', 'retain_until'].map((column) => `SELECT on column auth.audit_event.${column}`),
          ...['request_id', 'code', 'purged_count'].map(
            (column) => `INSERT on column auth.audit_event.${column}`,
          ),
        ],
        policies: ['app.audit_event', 'auth.audit_event'].flatMap((table) =>
          ['select', 'delete', 'insert'].map(
            (command) => `${table} policy purge_expired_audit_${command}`,
          ),
        ),
      },
    ],
    [
      'app.apply_retention(text)',
      {
        owner: 'owner_app_apply_retention',
        // No column outside the audit tables has a tenant_policy rule yet,
        // so it has no targets, and no rights on any table.
        rights: ['USAGE on schema app', 'EXECUTE on function app.current_tenant_id()'],
        policies: [],
      },
    ],
    [
      'app.destroy_subject_key(uuid)',
      {
        owner: 'owner_app_destroy_subject_key',
        // Never INSERT on occurred_at, retain_until or actor_member_kind,
        // nor on wrapped_key: it only ever clears a key.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
          ...['tenant_id', 'subject_party_id', 'id', 'destroyed_at'].map(
            (column) => `SELECT on column app.subject_key.${column}`,
          ),
          ...['tenant_id', 'subject_party_id', 'destroyed_at'].map(
            (column) => `INSERT on column app.subject_key.${column}`,
          ),
          ...['wrapped_key', 'destroyed_at'].map(
            (column) => `UPDATE on column app.subject_key.${column}`,
          ),
          ...['tenant_id', 'policy', 'days'].map(
            (column) => `SELECT on column app.retention_policy.${column}`,
          ),
          ...[
            'tenant_id',
            'request_id',
            'actor_kind',
            'action',
            'entity_type',
            'entity_id',
            'subject_party_id',
            'changes',
          ].map((column) => `INSERT on column app.audit_event.${column}`),
          // The ledger trigger runs as it (migration 0047); never erased_at.
          ...['tenant_id', 'subject_party_id', 'kind', 'subject_key_id', 'audit_event_id'].map(
            (column) => `INSERT on column app.erasure_ledger.${column}`,
          ),
          // A ledger row is its authority in restore mode (migration 0049).
          'SELECT on column app.restore_mode.active',
          ...['tenant_id', 'subject_party_id', 'kind'].map(
            (column) => `SELECT on column app.erasure_ledger.${column}`,
          ),
        ],
        // The tenant policies, TO PUBLIC, admit it; the app roles' UPDATE
        // and DELETE denials do not name it.
        policies: ['app.restore_mode policy restore_mode_select'],
      },
    ],
    [
      'app.reapply_erasure_ledger()',
      {
        owner: 'owner_app_reapply_erasure_ledger',
        // Never INSERT on occurred_at, retain_until or actor_member_kind,
        // which the database sets (ADR 0003, "Audit retention").
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'USAGE on schema grants',
          'EXECUTE on function app.current_tenant_id()',
          'EXECUTE on function party.erase_party(uuid,uuid)',
          'EXECUTE on function app.destroy_subject_key(uuid)',
          'EXECUTE on function grants.clear_answer_fields(uuid,text[])',
          ...['active', 'request_id'].map(
            (column) => `SELECT on column app.restore_mode.${column}`,
          ),
          ...['tenant_id', 'id', 'subject_party_id', 'kind', 'erased_at'].map(
            (column) => `SELECT on column app.erasure_ledger.${column}`,
          ),
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
          ...['tenant_id', 'id', 'user_id'].map(
            (column) => `SELECT on column party.person.${column}`,
          ),
          ...['tenant_id', 'id', 'user_id', 'status', 'roles'].map(
            (column) => `SELECT on column app.membership.${column}`,
          ),
          'UPDATE on column app.membership.status',
          ...['tenant_id', 'id', 'applicant_person_id', 'form_version_id'].map(
            (column) => `SELECT on column grants.application.${column}`,
          ),
          ...['tenant_id', 'id', 'definition'].map(
            (column) => `SELECT on column grants.form_version.${column}`,
          ),
          ...['tenant_id', 'policy', 'days'].map(
            (column) => `SELECT on column app.retention_policy.${column}`,
          ),
          ...[
            'tenant_id',
            'request_id',
            'actor_kind',
            'action',
            'entity_type',
            'entity_id',
            'changes',
          ].map((column) => `INSERT on column app.audit_event.${column}`),
        ],
        policies: ['app.restore_mode policy restore_mode_select'],
      },
    ],
    [
      'app.delete_swept_file(uuid)',
      {
        owner: 'owner_app_delete_swept_file',
        rights: [
          'USAGE on schema app',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'scan_state', 'scanned_at', 'linked_at', 'released_at'].map(
            (column) => `SELECT on column app.file.${column}`,
          ),
          'DELETE on app.file',
        ],
        policies: ['app.file policy sweep_delete'],
      },
    ],
    [
      'app.erase_file(uuid, uuid)',
      {
        owner: 'owner_app_erase_file',
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'erased_at'].map(
            (column) => `SELECT on column app.file.${column}`,
          ),
          'UPDATE on column app.file.erased_at',
          ...['tenant_id', 'id', 'kind', 'permission', 'status', 'filters'].map(
            (column) => `SELECT on column app.job_request.${column}`,
          ),
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
        ],
        policies: [],
      },
    ],
    [
      'app.erase_subject_notes(uuid)',
      {
        owner: 'owner_app_erase_notes',
        // Never DELETE, nor the columns that say who a row is about but the
        // notification's recipient, which it clears.
        rights: [
          'USAGE on schema app',
          'USAGE on schema party',
          'USAGE on schema grants',
          'EXECUTE on function app.current_tenant_id()',
          ...['tenant_id', 'id', 'status'].map(
            (column) => `SELECT on column party.party.${column}`,
          ),
          ...['tenant_id', 'id', 'applicant_person_id'].map(
            (column) => `SELECT on column grants.application.${column}`,
          ),
          ...['tenant_id', 'note_id', 'application_id'].map(
            (column) => `SELECT on column grants.application_note.${column}`,
          ),
          ...['tenant_id', 'thread_id', 'application_id'].map(
            (column) => `SELECT on column grants.application_message.${column}`,
          ),
          ...['tenant_id', 'id', 'body'].map((column) => `SELECT on column app.note.${column}`),
          'UPDATE on column app.note.body',
          ...['tenant_id', 'thread_id', 'body'].map(
            (column) => `SELECT on column app.message.${column}`,
          ),
          'UPDATE on column app.message.body',
          ...['tenant_id', 'recipient_person_id', 'status', 'error_code'].map(
            (column) => `SELECT on column grants.message_notification.${column}`,
          ),
          ...['recipient_person_id', 'status', 'error_code'].map(
            (column) => `UPDATE on column grants.message_notification.${column}`,
          ),
        ],
        policies: [],
      },
    ],
  ],
  nonTenantTables: [
    [
      'app.request_limit',
      'Hashed client keys and counters for rate limits; holds no tenant data (ADR 0028).',
    ],
    [
      'app.job_queue',
      "The queue register, platform configuration that only migrator writes; part of ADR 0009's named exception to rule 2.",
    ],
    [
      'app.restore_mode',
      "One row for the cell (ADR 0011): whether it is being restored. Only migrator writes it, so no tenant's data is in it.",
    ],
  ],
  tenantKeyedById: [
    [
      'app.tenant',
      'Each row is a tenant, so its policies use id = app.current_tenant_id() (ADR 0003).',
    ],
  ],
  auditTables: ['app.audit_event'],
};
