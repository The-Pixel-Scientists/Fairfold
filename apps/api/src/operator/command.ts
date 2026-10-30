// SPDX-License-Identifier: AGPL-3.0-or-later
//
// pnpm tenant:create --slug <slug> --name <name> --admin-email <address>
// (ADR 0019): the operator makes a tenant and invites its first
// administrator. The input is checked with the shared schemas before
// anything connects, and a bad slug, a taken one or a bad name ends with a
// plain message and nothing written. It prints the tenant's id and slug and
// never a token or a link.
//
// The tenant is made, then its event is recorded, then the invitation is
// sent, each in its own transaction as app_worker. If the email cannot be
// sent, the tenant and its event stay, and the command says that the first
// administrator has not been invited.

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { createDatabase } from '@pixel-scientists/db';
import { messageForIssue, slugSchema } from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { inviteSchema } from '@pixel-scientists/domain/platform/team';
import type { z } from 'zod';

import { recordAudit } from '../audit/writer.ts';
import { createOperatorInvitation } from '../auth/index.ts';
import { ConfigError } from '../config.ts';
import { createSender, type Sender } from '../email/sender.ts';
import { createSmtpTransport } from '../email/transport.ts';
import { createLogger } from '../logger.ts';
import { loadOperatorSettings } from './settings.ts';
import { makeTenant } from './tenant.ts';

const USAGE = 'Usage: pnpm tenant:create --slug <slug> --name <name> --admin-email <address>';

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

/** The value if `schema` accepts it, or the plain problems with it. */
function check<T>(schema: z.ZodType<T>, value: unknown, label: string): T | string[] {
  const result = schema.safeParse(value);
  return result.success
    ? result.data
    : result.error.issues.map((issue) => `${label}: ${messageForIssue(issue)}`);
}

/** Pg's error code, if `error` carries one. */
const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/**
 * Run the command. Returns the exit code: 0 when the tenant is made and the
 * invitation is sent. A `sender` replaces the configured mail server.
 */
export async function runCreateTenant(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  output: Output,
  sender?: Sender,
): Promise<number> {
  let values: { slug?: string; name?: string; 'admin-email'?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        slug: { type: 'string' },
        name: { type: 'string' },
        'admin-email': { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    output.err(USAGE);
    return 2;
  }
  if (
    values.slug === undefined ||
    values.name === undefined ||
    values['admin-email'] === undefined
  ) {
    output.err(USAGE);
    return 2;
  }

  const slug = check(slugSchema, values.slug, 'Slug');
  const name = check(tenantNameSchema, values.name, 'Name');
  const email = check(inviteSchema.shape.email, values['admin-email'], 'Admin email');
  if (typeof slug !== 'string' || typeof name !== 'string' || typeof email !== 'string') {
    for (const problems of [slug, name, email]) {
      if (typeof problems === 'string') continue;
      for (const problem of problems) output.err(problem);
    }
    return 2;
  }

  let settings;
  try {
    settings = loadOperatorSettings(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const problem of error.problems) output.err(problem);
    return 2;
  }
  const { database, smtp, consoleBase } = settings;
  const logger = createLogger({ level: 'warn' });
  const mail = sender ?? createSender(smtp, logger, createSmtpTransport(smtp));
  const worker = createDatabase<unknown>({
    host: database.host,
    port: database.port,
    database: database.database,
    role: 'app_worker',
    password: database.password.reveal(),
    applicationName: 'tps-operator',
    tls: database.tls,
  });

  const requestId = randomUUID();
  try {
    let tenant;
    try {
      tenant = await makeTenant(worker, { slug, name });
    } catch (error) {
      output.err(
        codeOf(error) === '23505'
          ? 'That slug is already taken. Choose another.'
          : 'The tenant could not be created, and nothing was written.',
      );
      return 1;
    }
    output.out(`Created tenant ${slug} (${tenant.id}).`);
    try {
      await tenant.inTenant((trx) =>
        recordAudit(
          trx,
          { kind: 'operator', requestId },
          {
            action: 'platform.tenant.created',
            entityId: tenant.id,
            changes: { 'app.tenant.slug': { after: slug }, 'app.tenant.name': { after: name } },
          },
        ),
      );
      await tenant.inTenant((trx) =>
        createOperatorInvitation(
          { consoleBase, sender: mail },
          trx,
          { kind: 'operator', requestId, tenant: { slug, name } },
          { email, roles: ['tenant_admin'] },
        ),
      );
    } catch {
      output.err(
        'The first administrator has not been invited. Check the mail and database settings.',
      );
      return 1;
    }
    output.out('Invited the first administrator by email.');
    return 0;
  } finally {
    await worker.destroy();
  }
}
