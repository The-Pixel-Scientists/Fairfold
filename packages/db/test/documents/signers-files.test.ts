// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.signature_signer and app.signature_request_file (migrations 0103 and 0104):
// denied across tenants, signers added to drafts only and moved by
// app_worker alone, files linked once and only by the role that may, and a
// request signed exactly when it has a signed file and evidence.

import { signerStatuses } from '@pixel-scientists/domain/documents';
import { beforeAll, describe, expect, it } from 'vitest';

import { addFile } from '../grants/application-fixtures.ts';
import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  committedIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addRequest,
  addRequestParts,
  linkFile,
  moveRequest,
  requestRow,
  signerRow,
  signRequest,
} from './fixtures.ts';

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant();
}, 30_000);

const fileLink = (request: string, role: string, file: string) => ({
  tenant_id: tenant.id,
  signature_request_id: request,
  role,
  file_id: file,
});

describe('app.signature_signer', { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.signature_signer', async (client, row) => {
      const parts = await addRequestParts(client, row);
      const request = await insertRow(client, 'app.signature_request', requestRow(row, parts));
      return signerRow(row, request, await addPerson(client, row));
    }));

  it('checks exactly the signer statuses of the contracts', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conname = 'signature_signer_status_check'`,
      ),
    );
    const literals = [...(rows[0]?.definition ?? '').matchAll(/'([^']*)'::text/g)].map(
      (match) => match[1],
    );
    expect(literals.sort()).toEqual([...signerStatuses].sort());
  });

  it('joins a draft only, once per person and order, from 1 to 10', async () => {
    const { request } = await asMigratorIn(tenant.id, (client) => addRequest(client, tenant));
    const [person, other] = await asMigratorIn(tenant.id, async (client) => [
      await addPerson(client, tenant),
      await addPerson(client, tenant),
    ]);
    const add = (change: Record<string, unknown>) =>
      insertOutcome(
        'app_api',
        tenant,
        'app.signature_signer',
        signerRow(tenant, request, person, change),
      );
    expect(await add({ signing_order: 1 })).toBe('23505');
    expect(await add({ signing_order: 0 })).toBe('23514');
    expect(await add({ signing_order: 11 })).toBe('23514');
    expect(await add({ signing_order: 2 })).toBe('ok');
    const { rows } = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'app.signature_signer',
        signerRow(tenant, request, person, {
          signing_order: 2,
          status: 'signed',
          signed_at: new Date(),
        }),
      );
      return client.query('SELECT status, signed_at FROM app.signature_signer WHERE id = $1', [id]);
    });
    expect(rows[0]).toEqual({ status: 'waiting', signed_at: null });
    expect(await add({ signing_order: 3 })).toBe('23505');
    await asMigratorIn(tenant.id, (client) => moveRequest(client, request, 'sent'));
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.signature_signer',
        signerRow(tenant, request, other, { signing_order: 3 }),
      ),
    ).toBe('55000');
  });

  it('is moved by app_worker alone; signed and declined are final, signed timed by the database', async () => {
    const { request } = await asMigratorIn(tenant.id, (client) => addRequest(client, tenant));
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, "UPDATE app.signature_signer SET status = 'sent'")).toBe(
        '42501',
      );
      expect(await outcome(client, 'DELETE FROM app.signature_signer')).toBe('42501');
    });
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const set = (status: string) =>
        outcome(
          client,
          'UPDATE app.signature_signer SET status = $2 WHERE signature_request_id = $1',
          [request, status],
        );
      expect(await outcome(client, 'UPDATE app.signature_signer SET signing_order = 2')).toBe(
        '42501',
      );
      await client.query(
        "UPDATE app.signature_signer SET status = 'signed' WHERE signature_request_id = $1",
        [request],
      );
      const { rows } = await client.query<{ recent: boolean }>(
        `SELECT signed_at > now() - interval '1 minute' AS recent FROM app.signature_signer
          WHERE signature_request_id = $1`,
        [request],
      );
      expect(rows[0]?.recent).toBe(true);
      expect(await set('declined')).toBe('55000');
    });
  });
});

describe('app.signature_request_file', { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.signature_request_file', async (client, row) => {
      const parts = await addRequestParts(client, row);
      const request = await insertRow(client, 'app.signature_request', requestRow(row, parts));
      return {
        tenant_id: row.id,
        signature_request_id: request,
        role: 'sent',
        file_id: parts.file,
      };
    }));

  it('takes the sent file from app_api, only for a draft with its hash, and links it', async () => {
    const parts = await asMigratorIn(tenant.id, (client) => addRequestParts(client, tenant));
    const [request, other] = await asMigratorIn(tenant.id, async (client) => [
      await insertRow(client, 'app.signature_request', requestRow(tenant, parts)),
      await addFile(client, tenant, parts.member),
    ]);
    const link = (role: string, file: string) =>
      insertOutcome('app_api', tenant, 'app.signature_request_file', fileLink(request, role, file));
    expect(await link('sent', other)).toBe('55000');
    expect(await link('signed', parts.file)).toBe('42501');
    expect(await link('evidence', parts.file)).toBe('42501');
    await asMigratorIn(tenant.id, (client) =>
      linkFile(client, tenant, request, 'sent', parts.file),
    );
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT linked_at IS NOT NULL AS linked FROM app.file WHERE id = $1', [
        parts.file,
      ]),
    );
    expect(rows[0]).toEqual({ linked: true });
    expect(await link('sent', parts.file)).toBe('23505');
  });

  it('takes the signed file and evidence from app_worker alone, never a removal', async () => {
    const draft = await asMigratorIn(tenant.id, (client) => addRequest(client, tenant));
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, draft.member));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'app.signature_request_file',
        fileLink(draft.request, 'sent', file),
      );
      expect(await outcome(client, text, values)).toBe('42501');
      expect(await outcome(client, 'DELETE FROM app.signature_request_file')).toBe('42501');
      expect(await outcome(client, "UPDATE app.signature_request_file SET role = 'sent'")).toBe(
        '42501',
      );
    });
  });

  it('holds a request signed exactly when it has a signed file and evidence, at commit', async () => {
    const draft = await asMigratorIn(tenant.id, (client) => addRequest(client, tenant));
    await expect(
      asMigratorIn(tenant.id, async (client) => {
        await moveRequest(client, draft.request, 'sent');
        await moveRequest(client, draft.request, 'signed');
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      asMigratorIn(tenant.id, async (client) => {
        await linkFile(
          client,
          tenant,
          draft.request,
          'evidence',
          await addFile(client, tenant, draft.member),
        );
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const signed = await asMigratorIn(tenant.id, (client) => signRequest(client, tenant, draft));
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT status FROM app.signature_request WHERE id = $1', [draft.request]),
    );
    expect(rows[0]).toEqual({ status: 'signed' });
    expect(signed.evidence).not.toBe(signed.signed);
  });

  it('lets app_worker sign a request in one transaction', async () => {
    const draft = await asMigratorIn(tenant.id, async (client) => {
      const made = await addRequest(client, tenant);
      await moveRequest(client, made.request, 'sent');
      return {
        ...made,
        signed: await addFile(client, tenant, made.member),
        evidence: await addFile(client, tenant, made.member),
      };
    });
    await withClient('app_worker', (client) =>
      committedIn(client, tenant.id, async (inTenant) => {
        for (const role of ['signed', 'evidence'] as const) {
          const { text, values } = insertStatement(
            inTenant,
            'app.signature_request_file',
            fileLink(draft.request, role, draft[role]),
          );
          await inTenant.query(text, values);
        }
        await inTenant.query("UPDATE app.signature_request SET status = 'signed' WHERE id = $1", [
          draft.request,
        ]);
      }),
    );
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query('SELECT status FROM app.signature_request WHERE id = $1', [draft.request]),
    );
    expect(rows[0]).toEqual({ status: 'signed' });
  });
});
