// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for tenant-context.yaml, checked by `semgrep --test infra/semgrep`.
// A comment may mention app.tenant_id or set_config.

import { sql } from 'kysely';

declare const tenantId: string;
declare const query: (text: string, values: unknown[]) => Promise<unknown>;

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`SELECT pg_catalog.set_config('app.tenant_id', ${tenantId}, true)`;

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`SET LOCAL APP.TENANT_ID = ${tenantId}`;

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`SET LOCAL "app"."tenant_id" = ${tenantId}`;

// ruleid: tps-tenant-setting-only-in-tenant-context
await query('SELECT set_config($1, $2, true)', ['app.other', tenantId]);

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`SET LOCAL "app" . "tenant_id" = ${tenantId}`;

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`UPDATE pg_catalog.pg_settings SET setting = ${tenantId} WHERE name = ${'app.' + 'tenant'}`;

// ruleid: tps-tenant-setting-only-in-tenant-context
sql`SET LOCAL app.U&"tenant\005fid" = ${tenantId}`;

// ruleid: tps-tenant-setting-only-in-tenant-context
export const setting = 'app.tenant_id';

// ok: tps-tenant-setting-only-in-tenant-context
sql`SELECT app.current_tenant_id() AS tenant`;

// ok: tps-tenant-setting-only-in-tenant-context
export const column = 'tenant_id';

declare type TenantId = string & { readonly brand: true };
declare const value: string;
// ruleid: tps-create-tenant-only-in-operator
import { createTenant } from '@pixel-scientists/db';

// ruleid: tps-tenant-id-only-from-tenant-context
export const cast = value as TenantId;

// ruleid: tps-tenant-id-only-from-tenant-context
export const doubleCast = value as unknown as TenantId;

// ruleid: tps-tenant-id-only-from-tenant-context
export const angled = <TenantId>value;

// ruleid: tps-tenant-id-only-from-tenant-context
export type { TenantId as Tenant };

// ok: tps-tenant-id-only-from-tenant-context
export function takes(tenant: TenantId): string {
  return tenant;
}

// ruleid: tps-create-tenant-only-in-operator
await createTenant({ slug: 'northfield', name: 'Northfield Community Trust' });

// ruleid: tps-create-tenant-only-in-operator
export const helpers = { make: createTenant };

// ruleid: tps-create-tenant-only-in-operator
sql`SELECT app.create_tenant(${'northfield'}, ${'Northfield'})`;

// ruleid: tps-create-tenant-only-in-operator
sql`SELECT "APP"."CREATE_TENANT"(${'northfield'}, ${'Northfield'})`;

// ok: tps-create-tenant-only-in-operator
sql`SELECT app.public_tenant(${'northfield'})`;

// ok: tps-create-tenant-only-in-operator
export const role = 'owner_app_create_tenant';
