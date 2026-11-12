// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CSV imports (migration 0063): a job links its file when it is added, and
// only a clean file never linked before; it moves only forward, with a
// failure code exactly when it failed, its file fixed, its other inputs
// fixed once it leaves queued and nothing changed once it finishes; the
// database sets when it was confirmed and finished. A row's cells and errors
// hold field ids from the list, errors never a value, and its created record
// is set once. No app role deletes either.

import { beforeAll, describe, expect, it } from 'vitest';

import type { LoginRole } from '../../scripts/roles.ts';
import { callAs } from '../erasure/fixtures.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addCrmParts,
  addImportJob,
  importJobRow,
  importRowRow,
  insertOutcome,
  type CrmParts,
} from './fixtures.ts';

let tenant: TestTenant;
let parts: CrmParts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addCrmParts(client, tenant));
}, 60_000);

const newJob = () =>
  asMigratorIn(tenant.id, (client) => addImportJob(client, tenant, parts.member));

/** Run `steps` in order as their roles, each committed, and return each outcome. */
async function run(job: string, steps: readonly [LoginRole, string][]): Promise<string[]> {
  const results: string[] = [];
  for (const [role, set] of steps) {
    const { code } = await callAs(role, tenant, `UPDATE crm.import_job SET ${set} WHERE id = $1`, [
      job,
    ]);
    results.push(code ?? 'ok');
  }
  return results;
}

describe('crm.import_job', { timeout: 60_000 }, () => {
  it("links a new job's file", async () => {
    const job = await newJob();
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query(
        `SELECT f.linked_at IS NOT NULL AS linked, f.released_at IS NOT NULL AS released
           FROM crm.import_job j JOIN app.file f ON f.tenant_id = j.tenant_id AND f.id = j.file_id
          WHERE j.id = $1`,
        [job],
      ),
    );
    expect(rows[0]).toEqual({ linked: true, released: false });
  });

  it('refuses a file that is not clean, is erased, or was ever linked', async () => {
    const files = await asMigratorIn(tenant.id, async (client) => {
      const application = await addApplication(client, tenant);
      const add = (state?: 'pending' | 'infected') => addFile(client, tenant, parts.member, state);
      const set = (id: string, change: string, values: unknown[] = []) =>
        client.query(`UPDATE app.file SET ${change} WHERE id = $1`, [id, ...values]);
      const attach = (file: string) =>
        insertRow(client, 'grants.application_file', {
          tenant_id: tenant.id,
          application_id: application.id,
          file_id: file,
          field_id: `f_${file.slice(0, 8)}`,
          created_by: application.parts.member,
        });
      const [pending, infected, withheld, erased, linked, released] = [
        await add('pending'),
        await add('infected'),
        await add(),
        await add(),
        await add(),
        await add(),
      ];
      await set(withheld, "scan_state = 'withheld', storage_key = $2, scan_version = 2", [
        `withheld/${tenant.id}/${withheld}`,
      ]);
      await set(erased, 'erased_at = now()');
      await attach(linked);
      await client.query('DELETE FROM grants.application_file WHERE id = $1', [
        await attach(released),
      ]);
      return { pending, infected, withheld, erased, linked, released };
    });
    for (const [kind, file] of Object.entries(files)) {
      const job = importJobRow(tenant, file, parts.member);
      expect(await insertOutcome('app_api', tenant, 'crm.import_job', job), kind).toBe('55000');
    }
  });

  it('moves forward from queued to completed, with the times set by the database', async () => {
    const job = await newJob();
    expect(
      await run(job, [
        ['app_worker', "state = 'checking'"],
        ['app_worker', "state = 'ready', row_count = 3, valid_count = 2"],
        ['app_api', "state = 'importing', confirmed_by = '" + parts.member + "'"],
        ['app_api', "state = 'completed', created_count = 2"],
      ]),
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<{ confirmed_at: Date | null; completed_at: Date | null }>(
        'SELECT confirmed_at, completed_at FROM crm.import_job WHERE id = $1',
        [job],
      ),
    );
    expect(rows[0]?.confirmed_at).toBeInstanceOf(Date);
    expect(rows[0]?.completed_at).toBeInstanceOf(Date);
    expect(await run(job, [['app_api', 'created_count = 1']])).toEqual(['23514']);
  });

  it('refuses a skipped or backward step, and a failure without its code', async () => {
    const job = await newJob();
    expect(
      await run(job, [
        ['app_worker', "state = 'ready'"],
        ['app_worker', "state = 'failed'"],
        ['app_worker', "state = 'checking'"],
        ['app_worker', "state = 'queued'"],
        ['app_api', "state = 'importing', confirmed_by = '" + parts.member + "'"],
        ['app_worker', "state = 'failed', error_code = 'not_csv'"],
        ['app_worker', "state = 'checking', error_code = NULL"],
      ]),
    ).toEqual(['23514', '23514', 'ok', '23514', '23514', 'ok', '23514']);
  });

  it('fixes its inputs once it leaves queued, and keeps confirmed_at from callers', async () => {
    const job = await newJob();
    expect(await run(job, [['app_api', 'confirmed_at = now()']])).toEqual(['42501']);
    expect(await run(job, [['app_api', 'header_row = false']])).toEqual(['42501']);
    await run(job, [['app_worker', "state = 'checking'"]]);
    const code = await asMigratorIn(tenant.id, (client) =>
      outcome(client, 'UPDATE crm.import_job SET header_row = false WHERE id = $1', [job]),
    );
    expect(code).toBe('23514');
  });

  it('keeps the file it linked, even while queued', async () => {
    const [job, file] = await asMigratorIn(tenant.id, async (client) => [
      await addImportJob(client, tenant, parts.member),
      await addFile(client, tenant, parts.member),
    ]);
    const code = await asMigratorIn(tenant.id, (client) =>
      outcome(client, 'UPDATE crm.import_job SET file_id = $2 WHERE id = $1', [job, file]),
    );
    expect(code).toBe('23514');
  });
});

describe('crm.import_row', { timeout: 60_000 }, () => {
  let job: string;
  beforeAll(async () => {
    job = await newJob();
  });

  it('holds listed field ids, errors without values, and no app role deletes it', async () => {
    const add = (change: Record<string, unknown>) =>
      insertOutcome('app_worker', tenant, 'crm.import_row', importRowRow(tenant, job, change));
    expect(await add({})).toBe('ok');
    expect(await add({ cells: JSON.stringify({ nickname: 'Ada' }) })).toBe('23514');
    expect(await add({ cells: JSON.stringify({ email: 7 }) })).toBe('23514');
    expect(await add({ errors: JSON.stringify([{ field: 'email', code: 'required' }]) })).toBe(
      'ok',
    );
    expect(
      await add({ errors: JSON.stringify([{ field: 'email', code: 'required', value: 'x' }]) }),
    ).toBe('23514');
    expect(await add({ errors: JSON.stringify([{ field: 'email', code: 'Bad value' }]) })).toBe(
      '23514',
    );
    expect(await add({ errors: JSON.stringify({ field: 'email' }) })).toBe('23514');
    expect(await add({ created_party_id: parts.person })).toBe('42501');
    for (const role of ['app_api', 'app_worker'] as const) {
      const code = await asRoleIn(role, tenant.id, (client) =>
        outcome(client, 'DELETE FROM crm.import_row WHERE job_id = $1', [job]),
      );
      expect(code, role).toBe('42501');
    }
  });

  it('sets the created record once, on confirm', async () => {
    const row = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'crm.import_row', importRowRow(tenant, job, { row_number: 3 })),
    );
    const set = async (party: string) =>
      (
        await callAs(
          'app_api',
          tenant,
          'UPDATE crm.import_row SET created_party_id = $1 WHERE id = $2',
          [party, row],
        )
      ).code ?? 'ok';
    expect(await set(parts.person)).toBe('ok');
    expect(await set(parts.organisation)).toBe('23514');
  });
});
