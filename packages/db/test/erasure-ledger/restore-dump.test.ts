// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A real pg_dump and restore (ADR 0027, ADR 0011): an older dump brings an
// erased person back, and re-apply erases them again. The dump and restore
// run inside the Compose PostgreSQL container, where the socket trusts each
// role, the dump taken as the backup role.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BACKUP_ROLE } from '../../scripts/roles.ts';
import { readDatabaseName } from '../../scripts/settings.ts';
import { connectionSettings } from '../connect.ts';
import { addErasureRequest, callAs, DESTROY, erase, rowsOf } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addClassifiedApplication, CLASSIFIED_ANSWERS } from './fixtures.ts';

const COMPOSE_FILE = resolve(import.meta.dirname, '../../../../infra/compose/compose.dev.yaml');
const REAPPLY = 'SELECT app.reapply_erasure_ledger() AS counts';

const liveDatabase = readDatabaseName(process.env, 'TPS_TEST_DB_NAME');
const restored = `${liveDatabase}_${randomBytes(4).toString('hex')}_restore`;
const dump = `/tmp/${restored}.dump`;

function inContainer(script: string, ...args: readonly string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'sh', '-c', script, 'sh', ...args],
    { encoding: 'utf8' },
  );
}

const inRestored = async <T>(
  role: 'migrator' | 'app_worker',
  tenant: TestTenant | undefined,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> => {
  const client = new pg.Client({ ...connectionSettings(role), database: restored });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (tenant) {
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const firstRow = async (
  tenant: TestTenant,
  sql: string,
  values: readonly unknown[],
): Promise<Row | undefined> =>
  inRestored('migrator', tenant, async (client) => {
    const { rows } = await client.query<Row>(sql, [...values]);
    return rows[0];
  });

const reapply = (tenant: TestTenant): Promise<Row> =>
  inRestored('app_worker', tenant, async (client) => {
    const { rows } = await client.query<{ counts: Row }>(REAPPLY);
    return rows[0]?.counts ?? {};
  });

let tenant: TestTenant;
let other: TestTenant;
let person: string;
let survivor: string;
let application: string;
let file: string;
let exported: Row[];

describe('restoring a dump older than an erasure', { timeout: 180_000 }, () => {
  beforeAll(async () => {
    tenant = await createTestTenant();
    other = await createTestTenant();
    survivor = await asMigratorIn(other.id, (client) => addPerson(client, other));
    const staff = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    const live = await asMigratorIn(tenant.id, (client) =>
      addClassifiedApplication(client, tenant),
    );
    person = live.person;
    application = live.application;
    file = live.file;
    await callAs(
      'app_worker',
      tenant,
      `INSERT INTO app.subject_key (tenant_id, subject_party_id, wrapped_key, kek_version)
       VALUES ($1, $2, $3, 1)`,
      [tenant.id, person, randomBytes(60)],
    );

    inContainer('pg_dump -Fc -U "$1" -d "$2" -f "$3"', BACKUP_ROLE, liveDatabase, dump);

    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, staff, person),
    );
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    expect((await callAs('app_worker', tenant, DESTROY, [person])).row).toEqual({
      destroyed: true,
    });
    exported = await rowsOf(tenant, 'app.erasure_ledger', 'subject_party_id', person);
    expect(exported).toHaveLength(2);

    inContainer('createdb -U "$POSTGRES_USER" -O migrator "$1"', restored);
    inContainer('pg_restore -U "$POSTGRES_USER" --exit-on-error -d "$1" "$2"', restored, dump);
    await inRestored('migrator', undefined, (client) =>
      client.query('UPDATE app.restore_mode SET active = true, request_id = $1', [randomUUID()]),
    );
  }, 180_000);

  afterAll(() => {
    inContainer('rm -f "$2"; dropdb -U "$POSTGRES_USER" --if-exists "$1"', restored, dump);
  }, 60_000);

  it('brings the erased person back before re-apply, and re-apply alone leaves them', async () => {
    const row = await firstRow(tenant, 'SELECT status FROM party.party WHERE id = $1', [person]);
    expect(row).toEqual({ status: 'active' });
    expect(await firstRow(tenant, 'SELECT count(*)::int AS n FROM app.erasure_ledger', [])).toEqual(
      { n: 0 },
    );
    expect(await reapply(tenant)).toMatchObject({ entries: 0, re_erased: 0 });
    expect(
      await firstRow(tenant, 'SELECT status FROM party.party WHERE id = $1', [person]),
    ).toEqual({ status: 'active' });
  });

  it('erases them once their rows are confirmed, in that tenant alone', async () => {
    for (const entry of exported) {
      await inRestored('migrator', tenant, (client) =>
        client.query('SELECT app.restore_erasure_ledger_row($1, $2, $3, $4, $5, $6)', [
          entry['id'],
          entry['subject_party_id'],
          entry['kind'],
          entry['subject_key_id'],
          entry['audit_event_id'],
          entry['erased_at'],
        ]),
      );
    }

    expect(await reapply(tenant)).toMatchObject({
      re_erased: 1,
      keys_destroyed: 1,
      answers_cleared: 1,
      files_erased: 1,
    });

    expect(
      await firstRow(tenant, 'SELECT status FROM party.party WHERE id = $1', [person]),
    ).toEqual({ status: 'erased' });
    expect(
      await firstRow(
        tenant,
        'SELECT given_name, family_name, phone, user_id, email FROM party.person WHERE id = $1',
        [person],
      ),
    ).toEqual({
      given_name: null,
      family_name: null,
      phone: null,
      user_id: null,
      email: `${person}@erased.invalid`,
    });
    expect(
      await firstRow(tenant, 'SELECT answers FROM grants.application WHERE id = $1', [application]),
    ).toEqual({ answers: { f_org: CLASSIFIED_ANSWERS.f_org } });
    expect(
      await firstRow(
        tenant,
        'SELECT name, sha256, storage_key, erased_at IS NOT NULL AS erased FROM app.file WHERE id = $1',
        [file],
      ),
    ).toEqual({ name: 'Erased file', sha256: null, storage_key: null, erased: true });
    expect(
      await firstRow(tenant, 'SELECT count(*)::int AS n FROM grants.application_file', []),
    ).toEqual({ n: 1 });
    expect(
      await firstRow(
        tenant,
        'SELECT wrapped_key, destroyed_at IS NOT NULL AS destroyed FROM app.subject_key WHERE subject_party_id = $1',
        [person],
      ),
    ).toEqual({ wrapped_key: null, destroyed: true });
    expect(await firstRow(tenant, 'SELECT count(*)::int AS n FROM app.erasure_ledger', [])).toEqual(
      { n: 2 },
    );
    expect(
      await firstRow(other, 'SELECT status FROM party.party WHERE id = $1', [survivor]),
    ).toEqual({ status: 'active' });
  });

  it('changes nothing when re-applied again', async () => {
    expect(await reapply(tenant)).toMatchObject({
      entries: 2,
      re_erased: 0,
      keys_destroyed: 0,
      answers_cleared: 0,
      files_erased: 0,
    });
  });
});
