// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file service through the whole API, against the test database as
// app_api and the development SeaweedFS and clamd (docker compose -f
// infra/compose/compose.dev.yaml up -d --wait, and `node scripts/dev.ts
// bucket` once for this worktree's bucket): what is scanned, stored, recorded
// and sent, the two key pairs, and two tenants.
//
// The EICAR test string is built at run time from parts, so no file holds it.

import { createHash, randomUUID } from 'node:crypto';

import { defineRoute } from '@pixel-scientists/domain/api';
import {
  encodeFileNameHeader,
  fileRefusals,
  fileTypes,
  fileViewSchema,
  MAX_FILE_BYTES,
} from '@pixel-scientists/domain/files';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { addMember, events, type Member } from '../../../test/settings-api.ts';
import { captureLogs, expectLooksMissing, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { route } from '../../routes/register.ts';
import { createFileService, loadFileSettings } from './index.ts';
import { createStorage } from './storage.ts';

// Each upload scans, writes and records in one request, which is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const putFile = defineRoute({
  method: 'POST',
  path: '/console/files-check',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Take a file',
  body: { raw: ['application/octet-stream'], maxBytes: MAX_FILE_BYTES },
  responses: {
    200: z.object({
      file: fileViewSchema.nullable(),
      refusal: z.enum(fileRefusals).nullable(),
    }),
  },
});

const getFile = defineRoute({
  method: 'GET',
  path: '/console/files-check/:fileId',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Send a file',
  params: z.strictObject({ fileId: z.uuid() }),
  responses: { 200: { raw: fileTypes } },
});

const settings = loadFileSettings(process.env);
const logs = captureLogs();

let api: FastifyInstance;
let database: ApiDatabase;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminB: Member;
let reviewerA: Member;
let as: ReturnType<typeof testAuth>['as'];

beforeAll(async () => {
  const { database: databaseSettings } = loadConfig({
    ...process.env,
    TPS_SMTP_HOST: '127.0.0.1',
    TPS_SMTP_PORT: '51025',
    TPS_SMTP_TLS: 'none',
    TPS_SMTP_FROM: 'grants@example.org',
    // Not read here: the API listens on no port in this test.
    TPS_API_PORT: '41002',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'trace', destination: logs.stream });
  database = openDatabase(databaseSettings, logger);
  const auth = testAuth();
  as = auth.as;
  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    files: createFileService(settings),
    auth: auth.module,
    routes: [
      route(putFile, async ({ context, input }) => {
        const result = await context.files.store({
          name: input.body.name,
          bytes: input.body.bytes,
          allowedTypes: fileTypes,
          maxBytes: MAX_FILE_BYTES,
        });
        return 'file' in result
          ? { file: result.file, refusal: null }
          : { file: null, refusal: result.refusal };
      }),
      route(getFile, ({ context, input }) =>
        context.files.send(input.params.fileId, { audit: true }),
      ),
    ],
  });
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

const sessionOf = (member: Member) =>
  as({
    app: member.app,
    session: testSession({ app: member.app, userId: member.userId, tenant: member.tenant.id }),
  });

const upload = (
  member: Member | undefined,
  name: string,
  bytes: Buffer,
  headers: Record<string, string> = {},
) =>
  api.inject({
    method: 'POST',
    url: '/api/console/files-check',
    headers: {
      'content-type': 'application/octet-stream',
      'file-name': encodeFileNameHeader(name),
      ...(member === undefined ? {} : sessionOf(member)),
      ...headers,
    },
    payload: bytes,
  });

const download = (member: Member | undefined, id: string) =>
  api.inject({
    method: 'GET',
    url: `/api/console/files-check/${id}`,
    ...(member === undefined ? {} : { headers: sessionOf(member) }),
  });

interface Stored {
  file: z.infer<typeof fileViewSchema> | null;
  refusal: (typeof fileRefusals)[number] | null;
}

function stored(response: LightMyRequestResponse): Stored {
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Stored>();
}

const fileRows = (tenant: TestTenant) =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      scan_state: string;
      sha256: Buffer | null;
      storage_key: string | null;
      created_by: string;
    }>(
      'SELECT id, name, scan_state, sha256, storage_key, created_by FROM app.file ORDER BY created_at',
    );
    return rows;
  });

/** A document that starts like a PDF, with a body of the given text. */
const pdf = (body = 'Accounts for the year to 31 March') =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
  );

/** The EICAR test string, from parts so that no file on disk holds it. */
const eicar = (): string =>
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');

describe('a clean file', () => {
  const name = `Accounts ${randomUUID()} – draft.pdf`;
  const bytes = pdf();
  let id = '';

  it('is scanned, stored and recorded, and the upload is audited without its name', async () => {
    const { file, refusal } = stored(await upload(adminA, name, bytes));
    expect(refusal).toBeNull();
    expect(file).toMatchObject({ name, type: 'application/pdf', bytes: bytes.length });
    id = file?.id ?? '';

    const rows = await fileRows(tenantA);
    expect(rows).toEqual([
      {
        id,
        name,
        scan_state: 'clean',
        sha256: createHash('sha256').update(bytes).digest(),
        storage_key: `clean/${tenantA.id}/${id}`,
        created_by: adminA.membershipId,
      },
    ]);

    const [event] = await events(tenantA, 'platform.file.uploaded');
    expect(event).toMatchObject({ entity_id: id, actor_id: adminA.membershipId });
    expect(event?.changes).toEqual({
      'app.file.content_type': { after: 'application/pdf' },
      'app.file.size_bytes': { after: bytes.length },
      'app.file.scan_state': { after: 'clean' },
    });
    expect(JSON.stringify(event)).not.toContain(name);
  });

  it('is sent with every header, and the download is audited', async () => {
    const response = await download(adminA, id);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(bytes)).toBe(true);
    expect(response.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition':
        `attachment; filename="${name.replaceAll('–', '_')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(name)}`,
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    });
    const [event] = await events(tenantA, 'platform.file.downloaded');
    expect(event).toMatchObject({ entity_id: id, actor_id: adminA.membershipId });
    expect(JSON.stringify(event)).not.toContain(name);
  });

  it('puts no file name, key or scanner reply in any log line', () => {
    const text = logs.text();
    expect(text).toContain('"requestId"');
    for (const secret of [name, encodeFileNameHeader(name), `clean/${tenantA.id}`]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/stream: |FOUND|INSTREAM/);
  });

  it('is a 404 for another tenant, as a missing file is', async () => {
    const other = await download(adminB, id);
    const missing = await download(adminB, randomUUID());
    expectLooksMissing(other, missing);
    expect(await events(tenantB, 'platform.file.downloaded')).toEqual([]);
  });

  it('is refused to a member without the permission, and to nobody signed in', async () => {
    expect((await download(reviewerA, id)).statusCode).toBe(403);
    expect((await download(undefined, id)).statusCode).toBe(401);
  });
});

describe('an upload', () => {
  it('is refused before the body is read to a member without the permission, and to nobody signed in', async () => {
    const before = (await fileRows(tenantA)).length;
    expect((await upload(reviewerA, 'Accounts.pdf', pdf())).statusCode).toBe(403);
    expect((await upload(undefined, 'Accounts.pdf', pdf())).statusCode).toBe(401);
    expect((await upload(adminA, 'Accounts.pdf', pdf(), { 'file-name': '' })).statusCode).toBe(400);
    expect(await fileRows(tenantA)).toHaveLength(before);
  });

  it('refuses a type, an extension and a size before any row exists', async () => {
    const before = (await fileRows(tenantA)).length;
    const text = Buffer.from('MZ not a document');
    expect(stored(await upload(adminA, 'Notes.pdf', text)).refusal).toBe('type_not_allowed');
    expect(stored(await upload(adminA, 'Accounts.hta', pdf())).refusal).toBe('wrong_extension');
    expect((await upload(adminA, 'Big.pdf', Buffer.alloc(MAX_FILE_BYTES + 1))).statusCode).toBe(
      413,
    );
    expect(await fileRows(tenantA)).toHaveLength(before);
  });

  it('ends infected for the EICAR test string, with nothing stored', async () => {
    // ClamAV matches EICAR only as a whole file or an object, so it goes in as a stream object.
    const bytes = Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ${eicar().length} >>\n` +
        `stream\n${eicar()}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    );
    const result = stored(await upload(adminA, 'Infected.pdf', bytes));
    expect(result).toEqual({ file: null, refusal: 'infected' });

    const row = (await fileRows(tenantA)).find((r) => r.name === 'Infected.pdf');
    expect(row).toMatchObject({ scan_state: 'infected', sha256: null, storage_key: null });
    const [event] = (await events(tenantA, 'platform.file.refused')).slice(-1);
    expect(event?.entity_id).toBe(row?.id);
    expect(event?.changes['app.file.scan_state']).toEqual({ after: 'infected' });
    expect(JSON.stringify(event)).not.toContain('Infected.pdf');

    // Not clean, so never sent, and no object exists under its key.
    expect((await download(adminA, row?.id ?? '')).statusCode).toBe(404);
    const storage = createStorage(settings.storage);
    expect(await storage.get(`clean/${tenantA.id}/${row?.id ?? ''}`)).toBeNull();
  });

  it('ends error for an encrypted PDF, with nothing stored', async () => {
    const encrypted = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
        `4 0 obj << /Filter /Standard /V 1 /R 2 /O (${'a'.repeat(32)}) /U (${'b'.repeat(32)}) /P -4 >> endobj`,
        `trailer << /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${'0'.repeat(32)}> <${'0'.repeat(32)}>] >>`,
        'startxref',
        '0',
        '%%EOF',
        '',
      ].join('\n'),
    );
    const result = stored(await upload(adminA, 'Locked.pdf', encrypted));
    expect(result).toEqual({ file: null, refusal: 'not_checked' });
    const row = (await fileRows(tenantA)).find((r) => r.name === 'Locked.pdf');
    expect(row).toMatchObject({ scan_state: 'error', sha256: null, storage_key: null });
  });
});

describe('the two key pairs', () => {
  const key = `clean/${randomUUID()}/${randomUUID()}`;

  it('refuse a write with the read key and a read with the write key', async () => {
    const readOnly = createStorage({ ...settings.storage, write: settings.storage.read });
    await expect(readOnly.put(key, pdf())).rejects.toThrow(
      'Storage refused a write with status 403',
    );
    const writeOnly = createStorage({ ...settings.storage, read: settings.storage.write });
    await expect(writeOnly.get(key)).rejects.toThrow('Storage refused a read with status 403');
  });

  it('write and read an object under the right ones', async () => {
    const storage = createStorage(settings.storage);
    const bytes = pdf('own key');
    await storage.put(key, bytes);
    expect(Buffer.from(await new Response(await storage.get(key)).arrayBuffer())).toEqual(bytes);
  });
});
