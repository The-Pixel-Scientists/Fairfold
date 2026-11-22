// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tps tenant create against the test database, through the operator
// command it runs: the tenant, its tool switch and its event are written by
// that command, and the cli prints only the tenant's id and slug. The test
// mail server is not running, so the invitation is not sent, which the
// operator command reports. POSIX only, as the secrets folder is.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase, publicTenant } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionSettings } from '../../../packages/db/test/connect.ts';
import { asMigratorIn, testSlug } from '../../../packages/db/test/tenants.ts';
import { runScript } from './child.ts';
import { run } from './cli.ts';
import { redactingOutput } from './output.ts';

const worker = connectionSettings('app_worker');
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

const folder = mkdtempSync(join(tmpdir(), 'tps-cli-tenant-'));
const secrets = join(folder, 'secrets');
afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await api.destroy();
});

const env = {
  // As apps/api/test/support.ts sets them; no mail server listens there.
  TPS_SMTP_HOST: '127.0.0.1',
  TPS_SMTP_PORT: '51025',
  TPS_SMTP_TLS: 'none',
  TPS_SMTP_FROM: 'grants@example.org',
  TPS_DEV: '1',
  TPS_DB_HOST: worker.host,
  TPS_DB_PORT: String(worker.port),
  TPS_DB_NAME: worker.database,
  TPS_CONSOLE_ORIGIN: 'https://console.example.org',
  PATH: process.env['PATH'],
};

async function tps(...argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['tenant', 'create', '--secrets-dir', secrets, ...argv], {
    env,
    platform: process.platform,
    output: redactingOutput({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    }),
    runScript,
    prompt: () => Promise.reject(new Error('No prompt is expected.')),
    fetch,
  });
  return { code, out: stdout.join(''), err: stderr.join('') };
}

const create = (slug: string, modules = 'grants') =>
  tps(
    '--slug',
    slug,
    '--name',
    'Northfield Community Trust',
    '--admin-email',
    'first@example.test',
    '--modules',
    modules,
  );

describe.skipIf(process.platform === 'win32')('tps tenant create', { timeout: 60_000 }, () => {
  beforeAll(() => {
    mkdirSync(secrets, { mode: 0o700 });
    writeFileSync(join(secrets, 'app_worker_password'), worker.password, { mode: 0o600 });
  });

  it('creates the tenant with its tools through the operator command, and records the event', async () => {
    const slug = testSlug();
    const result = await create(slug);
    const id = /Created tenant [a-z0-9-]+ \(([0-9a-f-]{36})\)\./.exec(result.out)?.[1] ?? '';
    expect(id, result.err).not.toBe('');
    expect(result.out + result.err).not.toContain(worker.password);
    expect(result.out + result.err).not.toContain('#token=');

    const events = await asMigratorIn(
      id,
      async (client) =>
        (
          await client.query<{ actor_kind: string; entity_id: string }>(
            "SELECT actor_kind, entity_id FROM app.audit_event WHERE action = 'platform.tenant.created'",
          )
        ).rows,
    );
    expect(events).toEqual([{ actor_kind: 'operator', entity_id: id }]);
    const tools = await asMigratorIn(
      id,
      async (client) =>
        (
          await client.query<{ module: string }>(
            'SELECT module FROM app.tenant_module WHERE enabled',
          )
        ).rows,
    );
    expect(tools).toEqual([{ module: 'grants' }]);
  });

  it('ends a bad or taken slug, or no tools, with a plain message and nothing written', async () => {
    const bad = await create('Bad Slug');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Slug:');

    const slug = testSlug();
    const none = await create(slug, ' ');
    expect(none.code).toBe(2);
    expect(none.err).toContain('No tool is on unless you list it.');
    expect(await publicTenant(api, slug)).toBeUndefined();

    await create(slug);
    const taken = await create(slug);
    expect(taken.code).toBe(1);
    expect(taken.err).toContain('That slug is already taken. Choose another.');
  });
});
