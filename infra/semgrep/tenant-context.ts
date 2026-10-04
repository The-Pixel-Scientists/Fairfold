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
