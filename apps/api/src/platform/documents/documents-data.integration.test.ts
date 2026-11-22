// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The documents tables' subject access and erasure contributions against the
// test database (ADR 0027, ADR 0040), as app_worker in a tenant's
// transaction: the person's requests and signer records are listed without
// the provider reference or the hash of the file sent, erasure clears the
// files of the requests they sign and keeps every id and status, a repeat
// after a restore clears again, and the other tenant and the other signer
// are untouched.

import { createDatabase, withTenant } from '@pixel-scientists/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import { addErasureRequest, erase } from '../../../../../packages/db/test/erasure/fixtures.ts';
import {
  addRequest,
  fileHash,
  signRequest,
} from '../../../../../packages/db/test/documents/fixtures.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type Row,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { documentsErasure } from './erasure.ts';
import { documentsSubjectData } from './subject-data.ts';

vi.setConfig({ testTimeout: 60_000 });

interface Funder {
  readonly tenant: TestTenant;
  readonly staff: string;
  readonly person: string;
  readonly request: string;
  readonly files: string[];
  readonly other: Awaited<ReturnType<typeof addRequest>>;
}

let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Funder;
let b: Funder;

async function addFunder(): Promise<Funder> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const staff = await addMember(client, tenant, ['programme_manager']);
    const person = await addPerson(client, tenant);
    const signed = await addRequest(client, tenant, person);
    const results = await signRequest(client, tenant, signed);
    const other = await addRequest(client, tenant);
    return {
      tenant,
      staff,
      person,
      request: signed.request,
      files: [signed.file, results.signed, results.evidence],
      other,
    };
  });
}

const inTenant = <T>(funder: Funder, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
  withTenant(worker, trustedTenantId(funder.tenant.id), work);

const filesOf = (funder: Funder, ids: readonly string[]) =>
  asMigratorIn(funder.tenant.id, async (client) => {
    const { rows } = await client.query<Row>(
      'SELECT id, erased_at IS NOT NULL AS erased FROM app.file WHERE id = ANY ($1::uuid[]) ORDER BY id',
      [ids],
    );
    return rows;
  });

const subject = (funder: Funder, partyId = funder.person) => ({
  partyId,
  givenName: null,
  familyName: null,
  email: null,
  accountId: null,
});

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-api-tests',
  });
  a = await addFunder();
  b = await addFunder();
});

afterAll(() => worker.destroy());

describe('subject access', () => {
  it("lists the person's request and signer record, without the provider reference or file hash", async () => {
    const data = await inTenant(a, (tx) => documentsSubjectData.subjectData(tx, a.person));
    expect(data['app.signature_signer']).toHaveLength(1);
    expect(data['app.signature_request']).toHaveLength(1);
    const [signer] = data['app.signature_signer'] ?? [];
    expect(signer?.['app.signature_signer.person_id']).toEqual({
      value: a.person,
      sensitivity: 'personal',
    });
    const [request] = data['app.signature_request'] ?? [];
    expect(request?.['app.signature_request.id']?.value).toBe(a.request);
    const ids = Object.keys(request ?? {});
    expect(ids).not.toContain('app.signature_request.provider_reference');
    expect(ids).not.toContain('app.signature_request.sent_sha256');
  });

  it("holds nothing of another signer, or of another tenant's person", async () => {
    const none = await inTenant(a, (tx) => documentsSubjectData.subjectData(tx, a.other.signer));
    expect(none['app.signature_signer']).toHaveLength(1);
    expect(
      none['app.signature_signer']?.[0]?.['app.signature_signer.signature_request_id']?.value,
    ).toBe(a.other.request);
    const across = await inTenant(a, (tx) => documentsSubjectData.subjectData(tx, b.person));
    expect(across).toEqual({ 'app.signature_request': [], 'app.signature_signer': [] });
  });
});

describe('erasure', () => {
  it("clears the files of the person's requests, keeps the rest, and leaves the other tenant alone", async () => {
    const request = await asMigratorIn(a.tenant.id, (client) =>
      addErasureRequest(client, a.tenant, a.staff, a.person),
    );
    expect((await erase(a.tenant, a.person, request)).code).toBeUndefined();
    const counts = await inTenant(a, (tx) => documentsErasure.erase(tx, [subject(a)]));
    expect(counts).toEqual({ 'app.file': 3 });
    expect((await filesOf(a, a.files)).every((file) => file['erased'] === true)).toBe(true);
    expect((await filesOf(a, [a.other.file])).every((file) => file['erased'] === false)).toBe(true);
    expect((await filesOf(b, b.files)).every((file) => file['erased'] === false)).toBe(true);
    const kept = await asMigratorIn(a.tenant.id, async (client) => {
      const { rows } = await client.query<Row>(
        'SELECT status, sent_sha256 = $2 AS hash_kept FROM app.signature_request WHERE id = $1',
        [a.request, fileHash(a.files[0] ?? '')],
      );
      return rows;
    });
    expect(kept).toEqual([{ status: 'signed', hash_kept: true }]);
  });

  it('erases restored files when applied again', async () => {
    await asMigratorIn(a.tenant.id, async (client) => {
      await client.query('ALTER TABLE app.file DISABLE TRIGGER record_file_scan');
      for (const id of a.files) {
        await client.query(
          `UPDATE app.file SET erased_at = NULL, name = 'Agreement.pdf', sha256 = $2,
                  storage_key = 'clean/' || tenant_id || '/' || id WHERE id = $1`,
          [id, fileHash(id)],
        );
      }
      await client.query('ALTER TABLE app.file ENABLE TRIGGER record_file_scan');
    });
    expect((await filesOf(a, a.files)).every((file) => file['erased'] === false)).toBe(true);
    const counts = await inTenant(a, (tx) => documentsErasure.erase(tx, [subject(a)]));
    expect(counts).toEqual({ 'app.file': 3 });
    expect((await filesOf(a, a.files)).every((file) => file['erased'] === true)).toBe(true);
  });

  it('refuses a person who is not erased', async () => {
    await expect(inTenant(b, (tx) => documentsErasure.erase(tx, [subject(b)]))).rejects.toThrow();
    expect((await filesOf(b, b.files)).every((file) => file['erased'] === false)).toBe(true);
  });
});
