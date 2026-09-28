// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for restricted-imports.yaml, checked by `semgrep --test infra/semgrep`.

// ruleid: pixelgrant-database-imports-only-in-db
import pg from 'pg';
// ruleid: pixelgrant-database-imports-only-in-db
import { Kysely } from 'kysely';
// ruleid: pixelgrant-database-imports-only-in-db
import { Migrator } from 'kysely/migration';
// ruleid: pixelgrant-database-imports-only-in-db
import type { PgBoss } from 'pg-boss';
// ruleid: pixelgrant-database-imports-only-in-db
const pool = await import('pg-pool');
// ok: pixelgrant-database-imports-only-in-db
import { withTenant } from '@pixelgrant/db';

// ruleid: pixelgrant-better-auth-only-in-auth
import { betterAuth } from 'better-auth';
// ruleid: pixelgrant-better-auth-only-in-auth
import { sso } from '@better-auth/sso';
// ok: pixelgrant-better-auth-only-in-auth
import { z } from 'zod';

// ruleid: pixelgrant-radix-only-in-ui
import { Dialog } from 'radix-ui';
// ruleid: pixelgrant-radix-only-in-ui
export * from '@radix-ui/react-dialog';
// ok: pixelgrant-radix-only-in-ui
import { Button } from '@pixelgrant/ui';

export { pg, Kysely, Migrator, pool, withTenant, betterAuth, sso, z, Dialog, Button };
export type { PgBoss };
