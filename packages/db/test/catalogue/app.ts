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
        ],
        // The tenant policies, TO PUBLIC, admit it; the app roles' UPDATE
        // and DELETE denials do not name it.
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
  ],
  tenantKeyedById: [
    [
      'app.tenant',
      'Each row is a tenant, so its policies use id = app.current_tenant_id() (ADR 0003).',
    ],
  ],
  auditTables: ['app.audit_event'],
};
