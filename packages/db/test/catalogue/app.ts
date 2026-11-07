// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The catalogue test's allowlists for the app schema.

import { APP_ROLES } from '../connect.ts';
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
    ['app.current_tenant_id()', APP_ROLES],
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
