// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retention of CSV imports (migration 0064): app.apply_retention() deletes
// import rows 30 days after their job last changed, or the tenant's longer
// setting, and import jobs after 90 days once no row is left, releasing the
// job's file so the file sweep removes it. It acts in the tenant set alone,
// at most 1000 rows a call, and writes one event a call that deletes. Even
// its owner cannot delete a row inside the platform minimum, and no tenant
// may keep rows past 90 days or jobs past 366.

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { callAs } from '../erasure/fixtures.ts';
import { asMigratorIn, createTestTenant, insertRow, type TestTenant } from '../tenants.ts';
import { addCrmParts, addImportJob, insertOutcome } from './fixtures.ts';

const APPLY = 'SELECT * FROM app.apply_retention($1)';

interface Tenant {
  readonly tenant: TestTenant;
  readonly member: string;
}

async function newTenant(): Promise<Tenant> {
  const tenant = await createTestTenant();
  const { member } = await asMigratorIn(tenant.id, (client) => addCrmParts(client, tenant));
  return { tenant, member };
}

/** An import job with `rows` rows, last changed (and its rows written) `days` ago. */
async function importAged({ tenant, member }: Tenant, rows: number, days: number) {
  return asMigratorIn(tenant.id, async (client) => {
    const job = await addImportJob(client, tenant, member);
    await client.query(
      `INSERT INTO crm.import_row (tenant_id, job_id, row_number, cells)
       SELECT $1, $2, n, '{"given_name": "Ada"}' FROM generate_series(1, $3::integer) AS n`,
      [tenant.id, job, rows],
    );
    await client.query('ALTER TABLE crm.import_job DISABLE TRIGGER set_updated_at');
    await client.query(
      'UPDATE crm.import_job SET updated_at = now() - make_interval(days => $2) WHERE id = $1',
      [job, days],
    );
    await client.query('ALTER TABLE crm.import_job ENABLE TRIGGER set_updated_at');
    await client.query(
      'UPDATE crm.import_row SET created_at = now() - make_interval(days => $2) WHERE job_id = $1',
      [job, days],
    );
    const { rows: files } = await client.query<{ file_id: string }>(
      'SELECT file_id FROM crm.import_job WHERE id = $1',
      [job],
    );
    return { job, file: files[0]?.file_id ?? '' };
  });
}

const apply = async ({ tenant }: Tenant, policy: string) =>
  (await callAs('app_worker', tenant, APPLY, [policy])).row;

/** Each job's remaining row count, and whether it still exists, as migrator. */
async function remaining({ tenant }: Tenant, jobs: readonly string[]) {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ job: string; present: boolean; rows: number }>(
      `SELECT j.id AS job, EXISTS (SELECT FROM crm.import_job k WHERE k.id = j.id) AS present,
              (SELECT count(*)::integer FROM crm.import_row r WHERE r.job_id = j.id) AS rows
         FROM unnest($1::uuid[]) WITH ORDINALITY AS j(id, n) ORDER BY j.n`,
      [jobs],
    ),
  );
  return rows.map(({ present, rows: count }) => ({ present, rows: count }));
}

async function events({ tenant }: Tenant) {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ actor_kind: string; entity_id: string; changes: unknown }>(
      `SELECT actor_kind, entity_id, changes FROM app.audit_event
        WHERE action = 'platform.retention.applied' ORDER BY occurred_at`,
    ),
  );
  return rows;
}

describe('app.apply_retention for crm imports', { timeout: 120_000 }, () => {
  it('deletes import rows past 30 days in the tenant set, 1000 a call, with one event a deleting call', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const expired = await importAged(a, 1001, 31);
    const fresh = await importAged(a, 2, 29);
    const other = await importAged(b, 1, 31);

    const deleted = [];
    for (let call = 0; call < 3; call++) deleted.push(await apply(a, 'crm_import_rows'));
    expect(deleted).toEqual([
      { target: 'crm.import_row', deleted: 1000, anonymised: 0 },
      { target: 'crm.import_row', deleted: 1, anonymised: 0 },
      { target: 'crm.import_row', deleted: 0, anonymised: 0 },
    ]);
    expect(await remaining(a, [expired.job, fresh.job])).toEqual([
      { present: true, rows: 0 },
      { present: true, rows: 2 },
    ]);
    expect(await remaining(b, [other.job])).toEqual([{ present: true, rows: 1 }]);
    expect(await events(a)).toEqual(
      [1000, 1].map((count) => ({
        actor_kind: 'system',
        entity_id: a.tenant.id,
        changes: { policy: 'crm_import_rows', target: 'crm.import_row', deleted: count },
      })),
    );
    expect(await events(b)).toEqual([]);
  });

  it("keeps import rows for the tenant's longer setting", async () => {
    const a = await newTenant();
    await asMigratorIn(a.tenant.id, (client) =>
      insertRow(client, 'app.retention_policy', {
        tenant_id: a.tenant.id,
        policy: 'crm_import_rows',
        days: 60,
        created_by: a.member,
        updated_by: a.member,
      }),
    );
    const kept = await importAged(a, 1, 45);
    const expired = await importAged(a, 1, 61);
    expect(await apply(a, 'crm_import_rows')).toMatchObject({ deleted: 1 });
    expect(await remaining(a, [kept.job, expired.job])).toEqual([
      { present: true, rows: 1 },
      { present: true, rows: 0 },
    ]);
  });

  it('refuses a tenant setting past the ceiling: 90 days for rows, 366 for jobs', async () => {
    const a = await newTenant();
    const set = (policy: string, days: number) =>
      insertOutcome('app_api', a.tenant, 'app.retention_policy', {
        tenant_id: a.tenant.id,
        policy,
        days,
        created_by: a.member,
        updated_by: a.member,
      });
    expect(await set('crm_import_rows', 90)).toBe('ok');
    expect(await set('crm_import_rows', 91)).toBe('23514');
    expect(await set('crm_import_rows', 36500)).toBe('23514');
    expect(await set('crm_import_jobs', 366)).toBe('ok');
    expect(await set('crm_import_jobs', 367)).toBe('23514');
  });

  it('deletes a job past 90 days once no row is left, and releases its file for the sweep', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const withRows = await importAged(a, 1, 91);
    const empty = await importAged(a, 0, 91);
    const young = await importAged(a, 0, 89);
    const other = await importAged(b, 0, 91);

    expect(await apply(a, 'crm_import_jobs')).toEqual({
      target: 'crm.import_job',
      deleted: 1,
      anonymised: 0,
    });
    expect(await remaining(a, [withRows.job, empty.job, young.job])).toEqual([
      { present: true, rows: 1 },
      { present: false, rows: 0 },
      { present: true, rows: 0 },
    ]);
    expect(await remaining(b, [other.job])).toEqual([{ present: true, rows: 0 }]);
    const sweep = 'SELECT app.delete_swept_file($1) AS deleted';
    expect((await callAs('app_worker', a.tenant, sweep, [empty.file])).row).toEqual({
      deleted: true,
    });
    expect((await callAs('app_worker', a.tenant, sweep, [young.file])).row).toEqual({
      deleted: false,
    });

    expect(await apply(a, 'crm_import_rows')).toMatchObject({ deleted: 1 });
    expect(await apply(a, 'crm_import_jobs')).toMatchObject({ deleted: 1 });
    expect(await remaining(a, [withRows.job])).toEqual([{ present: false, rows: 0 }]);
    expect((await events(a)).map(({ changes }) => changes)).toEqual([
      { policy: 'crm_import_jobs', target: 'crm.import_job', deleted: 1 },
      { policy: 'crm_import_rows', target: 'crm.import_row', deleted: 1 },
      { policy: 'crm_import_jobs', target: 'crm.import_job', deleted: 1 },
    ]);
  });

  it('holds even its owner to the platform minimum and to its own event', async () => {
    const a = await newTenant();
    const fresh = await importAged(a, 1, 29);
    const young = await importAged(a, 0, 89);
    await withClient('migrator', async (client: pg.ClientBase) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
          a.tenant.id,
        ]);
        await client.query('SET LOCAL ROLE owner_app_apply_retention');
        const rows = await client.query('DELETE FROM crm.import_row WHERE job_id = $1', [
          fresh.job,
        ]);
        const jobs = await client.query('DELETE FROM crm.import_job WHERE id = $1', [young.job]);
        expect([rows.rowCount, jobs.rowCount]).toEqual([0, 0]);
        await expect(
          client.query(
            `INSERT INTO app.audit_event
               (tenant_id, request_id, actor_kind, action, entity_type, entity_id, changes)
             VALUES ($1, gen_random_uuid(), 'system', 'platform.audit_event.purged',
                     'platform.audit_event', $1, '{}')`,
            [a.tenant.id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
