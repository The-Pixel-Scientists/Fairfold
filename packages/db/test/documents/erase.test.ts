// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.erase_subject_documents() (migration 0106, ADR 0027): only app_worker
// runs it, only for a party already erased in the transaction's tenant; it
// erases the files of every request the person signs, keeps ids, statuses
// and the recorded hash, deletes nothing, and, called again after a
// restore, erases the restored files. An erased person joins no request.

import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { insertOutcome } from '../notes/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addRequest, fileHash, signerRow, signRequest } from './fixtures.ts';

const ERASE_DOCUMENTS = 'SELECT app.erase_subject_documents($1) AS counts';

let tenant: TestTenant;
let staff: string;
let person: string;
let signed: Awaited<ReturnType<typeof addRequest>>;
let files: string[];
let kept: Awaited<ReturnType<typeof addRequest>>;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    staff = await addMember(client, tenant, ['programme_manager']);
    person = await addPerson(client, tenant);
    signed = await addRequest(client, tenant, person);
    const results = await signRequest(client, tenant, signed);
    files = [signed.file, results.signed, results.evidence];
    kept = await addRequest(client, tenant);
  });
}, 60_000);

const eraseDocuments = (party: string, inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_DOCUMENTS, [party]);

function filesOf(ids: readonly string[]): Promise<Row[]> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT id, name, sha256 IS NOT NULL AS hashed, erased_at IS NOT NULL AS erased
         FROM app.file WHERE id = ANY ($1::uuid[]) ORDER BY id`,
      [ids],
    );
    return rows;
  });
}

const erasedFiles = () =>
  files.map((id) => ({ id, name: 'Erased file', hashed: false, erased: true }));

/** What a restore from before the erasure brings back, past the guard it never went through. */
function restoreFiles() {
  return asMigratorIn(tenant.id, async (client) => {
    await client.query('ALTER TABLE app.file DISABLE TRIGGER record_file_scan');
    for (const id of files) {
      await client.query(
        `UPDATE app.file SET erased_at = NULL, name = 'Agreement.pdf', sha256 = $2,
                storage_key = 'clean/' || tenant_id || '/' || id
          WHERE id = $1`,
        [id, fileHash(id)],
      );
    }
    await client.query('ALTER TABLE app.file ENABLE TRIGGER record_file_scan');
  });
}

describe('app.erase_subject_documents()', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_DOCUMENTS, [person])).code).toBe('42501');
    expect((await eraseDocuments(person)).code).toBe('55000');
    expect((await eraseDocuments(person, null)).code).toBe('55000');
    expect((await filesOf(files)).every((file) => file['erased'] === false)).toBe(true);
  });

  it("erases the person's request files, keeps the rest, and counts", async () => {
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, staff, person),
    );
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    expect((await eraseDocuments(person, await createTestTenant())).code).toBe('55000');

    const { row, code } = await eraseDocuments(person);
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual({ 'app.file': 3 });
    expect(await filesOf(files)).toEqual(erasedFiles().sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(await filesOf([kept.file])).toEqual([
      { id: kept.file, name: 'Accounts 2025.pdf', hashed: true, erased: false },
    ]);
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<Row>(
        `SELECT r.status, r.sent_sha256 = $2 AS hash_kept, s.person_id
           FROM app.signature_request r
           JOIN app.signature_signer s ON s.tenant_id = r.tenant_id AND s.signature_request_id = r.id
          WHERE r.id = $1`,
        [signed.request, fileHash(signed.file)],
      ),
    );
    expect(rows).toEqual([{ status: 'signed', hash_kept: true, person_id: person }]);
    expect((await eraseDocuments(person)).row?.['counts']).toEqual({ 'app.file': 0 });
  });

  it('erases restored files when applied again', async () => {
    await restoreFiles();
    expect((await filesOf(files)).every((file) => file['erased'] === false)).toBe(true);
    expect((await eraseDocuments(person)).row?.['counts']).toEqual({ 'app.file': 3 });
    expect((await filesOf(files)).every((file) => file['erased'] === true)).toBe(true);
  });

  it('adds no erased person as a signer', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.signature_signer',
        signerRow(tenant, kept.request, person, { signing_order: 2 }),
      ),
    ).toBe('55000');
  });
});
