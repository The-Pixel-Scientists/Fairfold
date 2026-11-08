// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for auth-helpers.yaml, checked by `semgrep --test infra/semgrep`.

// ruleid: tps-tenant-helpers-only-in-auth
import { copyInRecordedTenant } from '../auth/audit-copy/recorded-tenant.ts';
// ruleid: tps-tenant-helpers-only-in-auth
import { writeInRecordedTenant as copy } from '../../src/auth/audit-copy/recorded-tenant';
// ruleid: tps-tenant-helpers-only-in-auth
export { replayAuthCopies } from './auth/audit-copy/replay.js';
// ruleid: tps-tenant-helpers-only-in-auth
const replay = await import('./auth/audit-copy/replay.ts');
// ruleid: tps-tenant-helpers-only-in-auth
import * as domains from '../auth/sso/domains.ts';
// ruleid: tps-tenant-helpers-only-in-auth
import type { RotationDependencies } from './auth/rotation/reencrypt.ts';
// ruleid: tps-tenant-helpers-only-in-auth
await auth.writeInRecordedTenant(api, event);
// ok: tps-tenant-helpers-only-in-auth
import { authPlugin } from './auth/index.ts';
// ok: tps-tenant-helpers-only-in-auth
import { ssoStartRoute } from '@pixel-scientists/domain/auth';
// ok: tps-tenant-helpers-only-in-auth
import { sso } from '@better-auth/sso';

// ruleid: tps-key-version-function-only-in-rotation
await sql`SELECT id, tenant_id FROM auth.sso_providers_by_key_version(${version})`.execute(db);
// ruleid: tps-key-version-function-only-in-rotation
await sql`SELECT * FROM "auth"."SSO_PROVIDERS_BY_KEY_VERSION"(${version})`.execute(db);
// ruleid: tps-key-version-function-only-in-rotation
const call = 'select * from sso_providers_by_key_version($1)';
// ruleid: tps-key-version-function-only-in-rotation
import { ssoProvidersByKeyVersion as providers } from '@pixel-scientists/db';
// ruleid: tps-key-version-function-only-in-rotation
const functions = await import('../../../../packages/db/src/sso-functions.ts');
// ok: tps-key-version-function-only-in-rotation
const owner = 'owner_auth_sso_providers_by_key_version';
// ok: tps-key-version-function-only-in-rotation
await trx.selectFrom('auth.sso_provider').select(['id', 'key_version']).execute();
