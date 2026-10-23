// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm tenant:create` against the test database, as app_worker: the tenant,
// its event and its first invitation, and every refusal before anything is
// written.

import { createDatabase, publicTenant } from '@pixel-scientists/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionSettings } from '../../../../packages/db/test/connect.ts';
import { asMigratorIn, testSlug } from '../../../../packages/db/test/tenants.ts';
import { smtpTestSettings } from '../../test/support.ts';
import type { Email, Sender } from '../email/sender.ts';
import { runCreateTenant } from './command.ts';

const reader = connectionSettings('app_api');
const api = createDatabase<unknown>({
  host: reader.host,
  port: reader.port,
  database: reader.database,
  role: 'app_api',
  password: reader.password,
  maxConnections: 1,
  applicationName: 'tps-db-tests',
});
afterAll(() => api.destroy());

const worker = connectionSettings('app_worker');
const env = {
  ...smtpTestSettings,
  TPS_DEV: '1',
  TPS_DB_HOST: worker.host,
  TPS_DB_PORT: String(worker.port),
  TPS_DB_NAME: worker.database,
  TPS_DB_APP_WORKER_PASSWORD: worker.password,
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
};

const rowsIn = (tenantId: string, query: string) =>
  asMigratorIn(
    tenantId,
    async (client) => (await client.query(query)).rows as Record<string, unknown>[],
  );

const sent: Email[] = [];
let mailWorks = true;
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve(mailWorks ? { sent: true } : { sent: false, code: 'rejected' });
  },
};
beforeEach(() => {
  sent.length = 0;
  mailWorks = true;
});

async function run(args: string[], settings: Record<string, string | undefined> = env) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCreateTenant(
    args,
    settings,
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    sender,
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const create = (slug: string, name = 'Northfield Community Trust', email = 'first@example.test') =>
  run(['--slug', slug, '--name', name, '--admin-email', email]);

const exists = async (slug: string) => (await publicTenant(api, slug)) !== undefined;

describe('tenant:create', { timeout: 60_000 }, () => {
  it('makes the tenant, records the event and invites the first administrator', async () => {
    const slug = testSlug();
    const email = `${testSlug()}@example.test`;
    const result = await create(slug, '  Northfield Community Trust ', email);

    expect(result.code, result.err).toBe(0);
    const id = /\(([0-9a-f-]{36})\)/.exec(result.out)?.[1] ?? '';
    expect(result.out).toContain(`Created tenant ${slug}`);
    expect(await exists(slug)).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(email);
    const link = /(https:\/\/\S+#token=)([A-Za-z0-9_-]+)/.exec(sent[0]?.text ?? '');
    expect(link?.[1]).toBe(`https://console.example.org/${slug}/invitation#token=`);
    expect(result.out + result.err).not.toContain(link?.[2] ?? 'no token');
    expect(result.out + result.err).not.toContain('invitation#');

    const [event] = await rowsIn(
      id,
      "SELECT actor_kind, actor_id, entity_id, changes FROM app.audit_event WHERE action = 'platform.tenant.created'",
    );
    expect(event).toEqual({
      actor_kind: 'operator',
      actor_id: null,
      entity_id: id,
      changes: {
        'app.tenant.slug': { after: slug },
        'app.tenant.name': { after: 'Northfield Community Trust' },
      },
    });
    const invitations = await rowsIn(id, 'SELECT email, roles, created_by FROM app.invitation');
    expect(invitations).toEqual([{ email, roles: ['tenant_admin'], created_by: null }]);
  });

  it('refuses a reserved, malformed or taken slug, and writes nothing', async () => {
    for (const slug of ['console', 'Bad Slug', 'ab', '']) {
      const result = await create(slug);
      expect(result.code, slug).toBe(2);
      expect(result.err, slug).not.toBe('');
    }
    expect(sent).toEqual([]);

    const slug = testSlug();
    expect((await create(slug)).code).toBe(0);
    sent.length = 0;
    const again = await create(slug, 'Another Trust');
    expect(again.code).toBe(1);
    expect(again.err).toBe('That slug is already taken. Choose another.');
    expect(sent).toEqual([]);
  });

  it('refuses a name with a line break, a NUL or hidden characters, before it connects', async () => {
    for (const name of ['Line\nBreak', 'Nul\u0000Name', 'Hid​den', '   ', 'x'.repeat(101)]) {
      const slug = testSlug();
      const result = await create(slug, name);
      expect(result.code, JSON.stringify(name)).toBe(2);
      expect(await exists(slug)).toBe(false);
    }
    // The settings are not even read: a command with a bad name and no database settings still says why.
    const bare = await run(
      ['--slug', testSlug(), '--name', 'Bad\nName', '--admin-email', 'a@example.test'],
      {},
    );
    expect(bare.err).toContain('Name:');
    expect(bare.err).not.toContain('TPS_DB');
  });

  it('refuses a bad address and missing or unknown options', async () => {
    const slug = testSlug();
    expect((await create(slug, 'Trust', 'not an address')).code).toBe(2);
    expect(await exists(slug)).toBe(false);
    for (const args of [[], ['--slug', slug], ['--slug', slug, '--name', 'A', '--tenant', 'x']]) {
      const result = await run(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err).toContain('Usage: pnpm tenant:create');
    }
  });

  it('reports every missing setting at once, naming the variables', async () => {
    const result = await run(
      ['--slug', testSlug(), '--name', 'Trust', '--admin-email', 'a@example.test'],
      {
        TPS_DEV: '1',
      },
    );
    expect(result.code).toBe(2);
    for (const name of [
      'TPS_DB_HOST',
      'TPS_DB_APP_WORKER_PASSWORD',
      'TPS_SMTP_HOST',
      'TPS_CONSOLE_ORIGIN',
    ]) {
      expect(result.err, name).toContain(name);
    }
  });

  it('keeps the tenant and its event, and says so, when the email is not sent', async () => {
    const slug = testSlug();
    mailWorks = false;
    const result = await create(slug);

    expect(result.code).toBe(1);
    expect(result.err).toContain('has not been invited');
    expect(await exists(slug)).toBe(true);
    const id = /\(([0-9a-f-]{36})\)/.exec(result.out)?.[1] ?? '';
    const invitations = await rowsIn(id, 'SELECT 1 FROM app.invitation');
    const events = await rowsIn(
      id,
      "SELECT 1 FROM app.audit_event WHERE action = 'platform.tenant.created'",
    );
    expect(invitations).toEqual([]);
    expect(events).toHaveLength(1);
  });
});
