// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the document and signature tests (migrations 0100 to 0106),
// with plainly synthetic values. Rows are added through a client connected
// as migrator with the tenant set.

import { createHash, randomBytes } from 'node:crypto';

import type pg from 'pg';

import { addFile } from '../grants/application-fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import { addMember, insertRow, type Row, type TestTenant } from '../tenants.ts';

/** The SHA-256 addFile() gives a clean file: that of its id. */
export const fileHash = (file: string): Buffer => createHash('sha256').update(file).digest();

export const templateRow = (tenant: TestTenant, member: string, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  template_id: '00000000-0000-4000-8000-000000000001',
  version: 1,
  kind: 'board_pack',
  audience: 'staff',
  title: 'Board pack',
  merge_fields: ['f_name'],
  body: JSON.stringify([{ type: 'paragraph', content: [{ field: 'f_name' }] }]),
  created_by: member,
  ...change,
});

/** A connection as the operator command writes it, with a new callback reference hash. */
export const connectionRow = (tenant: TestTenant, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  // One active connection per tenant and provider, so each row names its own.
  provider: `fake_${randomBytes(4).toString('hex')}`,
  account_id: 'team-1',
  api_token: randomBytes(48),
  api_token_key_version: 1,
  callback_reference_hash: randomBytes(32),
  callback_key_version: 1,
  ...change,
});

export const requestRow = (
  tenant: TestTenant,
  parts: { connection: string; member: string; file: string },
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  connection_id: parts.connection,
  sent_sha256: fileHash(parts.file),
  expires_at: new Date(Date.now() + 7 * 86_400_000),
  created_by: parts.member,
  ...change,
});

/** A member, an active connection and a clean PDF, as migrator. */
export async function addRequestParts(client: pg.ClientBase, tenant: TestTenant) {
  const member = await addMember(client, tenant, ['programme_manager']);
  return {
    member,
    connection: await insertRow(client, 'app.signature_connection', connectionRow(tenant)),
    file: await addFile(client, tenant, member),
  };
}

/** A draft request with its sent file linked and one signer, as migrator. */
export async function addRequest(client: pg.ClientBase, tenant: TestTenant, person?: string) {
  const parts = await addRequestParts(client, tenant);
  const request = await insertRow(client, 'app.signature_request', requestRow(tenant, parts));
  await linkFile(client, tenant, request, 'sent', parts.file);
  const signer = person ?? (await addPerson(client, tenant));
  await insertRow(client, 'app.signature_signer', signerRow(tenant, request, signer));
  return { ...parts, request, signer };
}

export const signerRow = (
  tenant: TestTenant,
  request: string,
  person: string,
  change: Row = {},
): Row => ({
  tenant_id: tenant.id,
  signature_request_id: request,
  person_id: person,
  signing_order: 1,
  ...change,
});

export function linkFile(
  client: pg.ClientBase,
  tenant: TestTenant,
  request: string,
  role: 'sent' | 'signed' | 'evidence',
  file: string,
): Promise<string> {
  return insertRow(client, 'app.signature_request_file', {
    tenant_id: tenant.id,
    signature_request_id: request,
    role,
    file_id: file,
  });
}

/** Move request $1 to status $2 as the worker does, with what each status needs. */
export const MOVE = `UPDATE app.signature_request
    SET status = $2,
        provider_reference = CASE WHEN $2 IN ('draft', 'cancelled', 'failed')
                                  THEN provider_reference ELSE 'envelope-' || id END,
        error_code = CASE WHEN $2 = 'failed' THEN 'signature.provider_unavailable' END
  WHERE id = $1`;

export const moveRequest = (client: pg.ClientBase, request: string, status: string) =>
  client.query(MOVE, [request, status]);

/** Sign a request: link a signed file and evidence and move it, as migrator. */
export async function signRequest(
  client: pg.ClientBase,
  tenant: TestTenant,
  request: { request: string; member: string },
) {
  const signed = await addFile(client, tenant, request.member);
  const evidence = await addFile(client, tenant, request.member);
  await moveRequest(client, request.request, 'sent');
  await linkFile(client, tenant, request.request, 'signed', signed);
  await linkFile(client, tenant, request.request, 'evidence', evidence);
  await moveRequest(client, request.request, 'signed');
  return { signed, evidence };
}
