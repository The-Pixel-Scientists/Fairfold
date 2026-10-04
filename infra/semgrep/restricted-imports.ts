// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for restricted-imports.yaml, checked by `semgrep --test infra/semgrep`.

// ruleid: tps-database-imports-only-in-db
import pg from 'pg';
// ruleid: tps-database-imports-only-in-db
import { Kysely } from 'kysely';
// ruleid: tps-database-imports-only-in-db
import { Migrator } from 'kysely/migration';
// ruleid: tps-database-imports-only-in-db
import type { PgBoss } from 'pg-boss';
// ruleid: tps-database-imports-only-in-db
const pool = await import('pg-pool');
// ok: tps-database-imports-only-in-db
import { withTenant } from '@pixel-scientists/db';

// ruleid: tps-better-auth-only-in-auth
import { betterAuth } from 'better-auth';
// ruleid: tps-better-auth-only-in-auth
import { sso } from '@better-auth/sso';
// ok: tps-better-auth-only-in-auth
import { z } from 'zod';

// ruleid: tps-nodemailer-only-in-email
import nodemailer from 'nodemailer';
// ruleid: tps-nodemailer-only-in-email
import type { Transporter } from 'nodemailer';
// ruleid: tps-nodemailer-only-in-email
const smtp = await import('nodemailer/lib/smtp-transport');
// ok: tps-nodemailer-only-in-email
import { sendEmail } from './email/index.ts';

// ruleid: tps-radix-only-in-ui
import { Dialog } from 'radix-ui';
// ruleid: tps-radix-only-in-ui
export * from '@radix-ui/react-dialog';
// ok: tps-radix-only-in-ui
import { Button } from '@pixel-scientists/ui';

export { pg, Kysely, Migrator, pool, withTenant, betterAuth, sso, z, nodemailer, smtp, sendEmail };
export { Dialog, Button };
export type { PgBoss, Transporter };
