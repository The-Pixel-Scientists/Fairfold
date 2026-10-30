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

// ruleid: tps-storage-keys-only-in-files
import { SignatureV4 } from '@smithy/signature-v4';
// ruleid: tps-storage-keys-only-in-files
const writeKey = readSecret(process.env, 'TPS_STORAGE_WRITE_SECRET_ACCESS_KEY');
// ruleid: tps-storage-keys-only-in-files
const readKeyId = process.env.TPS_STORAGE_READ_ACCESS_KEY_ID;
// ruleid: tps-storage-keys-only-in-files
const writeKeyFile = process.env.TPS_STORAGE_WRITE_SECRET_ACCESS_KEY_FILE;
// ruleid: tps-storage-keys-only-in-files
const readKey = await readFile('/run/secrets/storage_read_secret_key', 'utf8');
// ok: tps-storage-keys-only-in-files
const bucket = process.env.TPS_STORAGE_BUCKET;

// ruleid: tps-no-presigned-urls
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// ruleid: tps-no-presigned-urls
const post = await import('@aws-sdk/s3-presigned-post');
// ruleid: tps-no-presigned-urls
const url = await new SignatureV4(options).presign(request);
// ok: tps-no-presigned-urls
const signed = await new SignatureV4(options).sign(request);

export { pg, Kysely, Migrator, pool, withTenant, betterAuth, sso, z, nodemailer, smtp, sendEmail };
export { Dialog, Button, writeKey, readKeyId, writeKeyFile, readKey, bucket };
export { getSignedUrl, post, url, signed };
export type { PgBoss, Transporter };
