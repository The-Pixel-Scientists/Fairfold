// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.signature_connection and app.signature_request (migrations 0101 and 0102):
// denied across tenants, the values the database sets, the column grants
// that split app_api from app_worker and app_operator, and a status trigger
// that allows exactly the moves of canMoveTo().

import { randomBytes } from 'node:crypto';

import {
  canMoveTo,
  signatureFailures,
  signatureStatuses,
  type SignatureStatus,
} from '@pixel-scientists/domain/documents';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient, withRoleClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addRequestParts,
  connectionRow,
  fileHash,
  MOVE,
  moveRequest,
  requestRow,
} from './fixtures.ts';

/** How each status is reached from draft. */
const PATHS: Readonly<Record<SignatureStatus, readonly SignatureStatus[]>> = {
  draft: [],
  sent: ['sent'],
  viewed: ['sent', 'viewed'],
  signed: ['sent', 'signed'],
  declined: ['sent', 'declined'],
  expired: ['sent', 'expired'],
  cancelled: ['cancelled'],
  failed: ['failed'],
};

let tenant: TestTenant;
let parts: Awaited<ReturnType<typeof addRequestParts>>;

beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addRequestParts(client, tenant));
}, 30_000);

const addDraft = () =>
  asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.signature_request', requestRow(tenant, parts)),
  );

describe('app.signature_connection', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.signature_connection', (_client, row) => connectionRow(row)));

  it('is written by app_operator alone, and its hash and token read by no API role', async () => {
    expect(
      await insertOutcome('app_api', tenant, 'app.signature_connection', connectionRow(tenant)),
    ).toBe('42501');
    expect(
      await insertOutcome('app_worker', tenant, 'app.signature_connection', connectionRow(tenant)),
    ).toBe('42501');
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const column of ['api_token', 'account_id', 'callback_reference_hash']) {
        expect(await outcome(client, `SELECT ${column} FROM app.signature_connection`)).toBe(
          '42501',
        );
      }
    });
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(
        await outcome(client, 'SELECT callback_reference_hash FROM app.signature_connection'),
      ).toBe('42501');
      expect(await outcome(client, "UPDATE app.signature_connection SET status = 'closed'")).toBe(
        '42501',
      );
    });
  });

  it('starts active, allows one active per provider, and stays closed once closed', async () => {
    const other = await createTestTenant();
    await withRoleClient('app_operator', async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [other.id]);
      const { rows } = await client.query<{ id: string; status: string }>(
        `INSERT INTO app.signature_connection
           (tenant_id, provider, account_id, api_token, api_token_key_version,
            callback_reference_hash, callback_key_version)
         VALUES ($1, 'fake', 'team-1', $2, 1, $3, 1) RETURNING id, status`,
        [other.id, randomBytes(48), randomBytes(32)],
      );
      expect(rows[0]?.status).toBe('active');
      const second = connectionRow(other);
      expect(
        await outcome(
          client,
          `INSERT INTO app.signature_connection
             (tenant_id, provider, account_id, api_token, api_token_key_version,
              callback_reference_hash, callback_key_version)
           VALUES ($1, 'fake', 'team-2', $2, 1, $3, 1)`,
          [other.id, second['api_token'], second['callback_reference_hash']],
        ),
      ).toBe('23505');
      await client.query("UPDATE app.signature_connection SET status = 'closed' WHERE id = $1", [
        rows[0]?.id,
      ]);
      expect(
        await outcome(
          client,
          "UPDATE app.signature_connection SET status = 'active' WHERE id = $1",
          [rows[0]?.id],
        ),
      ).toBe('55000');
      await client.query('ROLLBACK');
    });
  });

  it('refuses a callback reference hash another tenant uses', async () => {
    const hash = randomBytes(32);
    await asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        'app.signature_connection',
        connectionRow(tenant, { provider: 'other', callback_reference_hash: hash }),
      ),
    );
    const other = await createTestTenant();
    await expect(
      asMigratorIn(other.id, (client) =>
        insertRow(
          client,
          'app.signature_connection',
          connectionRow(other, { callback_reference_hash: hash }),
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('app.signature_request', { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.signature_request', async (client, row) =>
      requestRow(row, await addRequestParts(client, row)),
    ));

  it('checks exactly the statuses and failure codes of the contracts', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ name: string; definition: string }>(
        `SELECT conname AS name, pg_catalog.pg_get_constraintdef(oid) AS definition
           FROM pg_catalog.pg_constraint
          WHERE conrelid = 'app.signature_request'::regclass AND contype = 'c'`,
      ),
    );
    const literals = (name: string) =>
      [...(rows.find((row) => row.name === name)?.definition ?? '').matchAll(/'([^']*)'::text/g)]
        .map((match) => match[1])
        .sort();
    expect(literals('signature_request_status_check')).toEqual([...signatureStatuses].sort());
    expect(literals('signature_request_error_code_check')).toEqual(
      signatureFailures.map((code) => `signature.${code}`).sort(),
    );
  });

  it('sets its status, reference, error code and times on insert, whatever is supplied', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        'app.signature_request',
        requestRow(tenant, parts, {
          status: 'signed',
          provider_reference: 'envelope-9',
          error_code: 'signature.upload_mismatch',
          created_at: new Date('2020-01-01'),
          updated_at: new Date('2020-01-01'),
        }),
      ),
    );
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query(
        `SELECT status, provider_reference, error_code,
                created_at > now() - interval '1 minute' AND updated_at = created_at AS recent
           FROM app.signature_request WHERE id = $1`,
        [id],
      ),
    );
    expect(rows[0]).toEqual({
      status: 'draft',
      provider_reference: null,
      error_code: null,
      recent: true,
    });
  });

  it.each([
    ['an expiry in the past', { expires_at: new Date(Date.now() - 60_000) }],
    ['an expiry over 90 days ahead', { expires_at: new Date(Date.now() + 91 * 86_400_000) }],
    ['a hash that is not 32 bytes', { sent_sha256: Buffer.alloc(31) }],
  ])('refuses %s', async (_name, change) => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.signature_request',
        requestRow(tenant, parts, change),
      ),
    ).toBe('23514');
  });

  it.each([
    ['a reference with a space', 'envelope 1'],
    ['a reference with a control character', 'envelope\u00071'],
    ['a reference over 200 characters', 'x'.repeat(201)],
  ])('refuses %s', async (_name, reference) => {
    const id = await addDraft();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(
        await outcome(
          client,
          "UPDATE app.signature_request SET status = 'sent', provider_reference = $2 WHERE id = $1",
          [id, reference],
        ),
      ).toBe('23514');
    });
  });

  it('is moved by app_worker alone, and deleted by no role', async () => {
    const id = await addDraft();
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const set of ["status = 'cancelled'", "provider_reference = 'x'", 'error_code = NULL']) {
        expect(
          await outcome(client, `UPDATE app.signature_request SET ${set} WHERE id = $1`, [id]),
        ).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM app.signature_request WHERE id = $1', [id])).toBe(
        '42501',
      );
    });
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const { text, values } = insertStatement(
        client,
        'app.signature_request',
        requestRow(tenant, parts),
      );
      expect(await outcome(client, text, values)).toBe('42501');
      expect(
        await outcome(client, 'UPDATE app.signature_request SET expires_at = now() WHERE id = $1', [
          id,
        ]),
      ).toBe('42501');
      expect(await outcome(client, 'DELETE FROM app.signature_request WHERE id = $1', [id])).toBe(
        '42501',
      );
      expect(
        await outcome(
          client,
          "UPDATE app.signature_request SET status = 'sent', provider_reference = 'envelope-1' WHERE id = $1",
          [id],
        ),
      ).toBe('ok');
    });
  });

  it('needs a provider reference once sent, and an error code exactly when failed', async () => {
    const id = await addDraft();
    await asRoleIn('app_worker', tenant.id, async (client) => {
      const set = (columns: string) =>
        outcome(client, `UPDATE app.signature_request SET ${columns} WHERE id = $1`, [id]);
      expect(await set("status = 'sent'")).toBe('23514');
      expect(await set("status = 'failed'")).toBe('23514');
      expect(await set("error_code = 'signature.provider_unavailable'")).toBe('23514');
      expect(await set("status = 'failed', error_code = 'signature.signer_unavailable'")).toBe(
        'ok',
      );
      expect(await set("status = 'cancelled'")).toBe('ok');
    });
  });

  it('keeps its provider reference once set', async () => {
    const id = await addDraft();
    await asMigratorIn(tenant.id, (client) => moveRequest(client, id, 'sent'));
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(
        await outcome(
          client,
          "UPDATE app.signature_request SET provider_reference = 'envelope-2' WHERE id = $1",
          [id],
        ),
      ).toBe('55000');
    });
  });

  it('allows exactly the moves canMoveTo() allows, and none from a final status', () =>
    withClient('migrator', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        const results: string[] = [];
        const expected: string[] = [];
        for (const from of signatureStatuses) {
          const id = await insertRow(client, 'app.signature_request', requestRow(tenant, parts));
          for (const step of PATHS[from]) await moveRequest(client, id, step);
          for (const to of signatureStatuses) {
            const result = await outcome(client, MOVE, [id, to]);
            results.push(`${from} -> ${to}: ${result}`);
            expected.push(
              `${from} -> ${to}: ${from === to || canMoveTo(from, to) ? 'ok' : '55000'}`,
            );
          }
        }
        expect(results).toEqual(expected);
      } finally {
        await client.query('ROLLBACK');
      }
    }));

  it('changes no other column, whoever asks', async () => {
    const id = await addDraft();
    await asMigratorIn(tenant.id, async (client) => {
      for (const [set, values] of [
        ["expires_at = expires_at + interval '1 day'", [id]],
        ['sent_sha256 = $2', [id, fileHash('other')]],
        ['connection_id = gen_random_uuid()', [id]],
      ] as const) {
        expect(
          await outcome(client, `UPDATE app.signature_request SET ${set} WHERE id = $1`, values),
        ).toBe('23514');
      }
    });
  });
});
