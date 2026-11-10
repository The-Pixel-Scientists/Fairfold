// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.monitoring_response (migration 0051): denied across tenants, one
// response per application, its checks and keys, no update for any role,
// the database's times, and a catalogue check that nothing but app_api
// reaches the table: no view, foreign key, function or other role's grant.

import { beforeAll, describe, expect, it } from 'vitest';

import { BACKUP_ROLE } from '../../scripts/roles.ts';
import { RIGHTS_ROLES, withClient, withRoleClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication, addPublishedForm, type Parts } from '../grants/application-fixtures.ts';
import { addRound } from '../grants/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { responseRow } from './fixtures.ts';

const TABLE = 'grants.monitoring_response';

let tenant: TestTenant;
let application: string;
let parts: Parts;
let otherRoundForm: string;
let strangers: { application: string; formVersion: string };
beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ id: application, parts } = await asMigratorIn(tenant.id, (client) =>
    addApplication(client, tenant),
  ));
  otherRoundForm = await asMigratorIn(tenant.id, async (client) =>
    addPublishedForm(client, tenant, await addRound(client, tenant), parts.member),
  );
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const { id, parts: theirs } = await addApplication(client, stranger);
    return { application: id, formVersion: theirs.formVersion };
  });
}, 60_000);

function inserted(change: Row): Promise<string> {
  return asRoleIn('app_api', tenant.id, (client) => {
    const { text, values } = insertStatement(
      client,
      TABLE,
      responseRow(tenant, parts, application, change),
    );
    return outcome(client, text, values);
  });
}

describe('grants.monitoring_response', { timeout: 30_000 }, () => {
  it('is denied across tenants, for every role with a grant', async () => {
    await expectCrossTenantDenial(TABLE, async (client, row) => {
      const { id, parts: added } = await addApplication(client, row);
      return responseRow(row, added, id);
    });
  });

  it('holds one response per application', async () => {
    expect(await inserted({})).toBe('ok');
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, TABLE, responseRow(tenant, parts, application));
      const { text, values } = insertStatement(
        client,
        TABLE,
        responseRow(tenant, parts, application),
      );
      expect(await outcome(client, text, values)).toBe('23505');
    });
  });

  it.each([
    ['answers that are not an object', { answers: '[]' }],
    ['an answer not keyed by a field id', { answers: { 'not a field id': 'x' } }],
    ['a malformed privacy notice version', { privacy_notice_version: 'bad version!' }],
  ])('refuses %s', async (_name, change) => {
    expect(await inserted(change)).toBe('23514');
  });

  it('refuses a row without a privacy notice version', async () => {
    expect(await inserted({ privacy_notice_version: null })).toBe('23502');
  });

  it.each([
    ["another tenant's application", () => ({ application_id: strangers.application })],
    ["another tenant's form version", () => ({ form_version_id: strangers.formVersion })],
    ["another round's form version", () => ({ form_version_id: otherRoundForm })],
  ])('refuses %s', async (_name, change) => {
    expect(await inserted(change())).toBe('23503');
  });

  it('sets the consent time itself, and refuses one from the caller', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, TABLE, responseRow(tenant, parts, application));
      const { rows } = await client.query<{ consent_given_at: Date }>(
        `SELECT consent_given_at FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.consent_given_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
    expect(await inserted({ consent_given_at: new Date(0) })).toBe('42501');
  });

  it('lets app_api delete a response on withdrawal, and no role update one', async () => {
    const update = `UPDATE ${TABLE} SET answers = '{}' WHERE application_id = $1`;
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, responseRow(tenant, parts, application)),
    );
    try {
      for (const role of RIGHTS_ROLES) {
        await withRoleClient(role, async (client) => {
          await client.query('BEGIN');
          await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
            tenant.id,
          ]);
          expect(await outcome(client, update, [application]), role).toBe('42501');
          await client.query('ROLLBACK');
        });
      }
      await asRoleIn('app_api', tenant.id, async (client) => {
        const remove = `DELETE FROM ${TABLE} WHERE application_id = $1`;
        expect((await client.query(remove, [application])).rowCount).toBe(1);
      });
    } finally {
      await asMigratorIn(tenant.id, (client) =>
        client.query(`DELETE FROM ${TABLE} WHERE application_id = $1`, [application]),
      );
    }
  });

  it('is reached by no view, foreign key, function or role but app_api and backup', async () => {
    await withClient('migrator', async (client) => {
      const reached = await client.query<{
        views: string;
        foreign_keys: string;
        functions: string[];
      }>(
        `SELECT
           (SELECT count(*) FROM pg_catalog.pg_depend d
              JOIN pg_catalog.pg_rewrite r
                ON r.oid = d.objid AND d.classid = 'pg_catalog.pg_rewrite'::regclass
             WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = $1::regclass
               AND r.ev_class <> $1::regclass) AS views,
           (SELECT count(*) FROM pg_catalog.pg_constraint c
             WHERE c.contype = 'f' AND c.confrelid = $1::regclass) AS foreign_keys,
           (SELECT coalesce(array_agg(p.proname::text), '{}') FROM pg_catalog.pg_proc p
             WHERE p.prosrc ~ 'monitoring_response') AS functions`,
        [TABLE],
      );
      expect(reached.rows[0]).toEqual({ views: '0', foreign_keys: '0', functions: [] });

      const grantees = await client.query<{ grantee: string }>(
        `SELECT DISTINCT g.grantee::regrole::text AS grantee
           FROM pg_catalog.pg_class c
           CROSS JOIN LATERAL (
             SELECT (pg_catalog.aclexplode(c.relacl)).grantee
             UNION ALL
             SELECT (pg_catalog.aclexplode(a.attacl)).grantee
               FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL
           ) AS g
          WHERE c.oid = $1::regclass AND g.grantee <> c.relowner`,
        [TABLE],
      );
      // The backup role reads every table, for the off-site backup (ADR 0011).
      expect(grantees.rows.map(({ grantee }) => grantee).sort()).toEqual(
        ['app_api', BACKUP_ROLE].sort(),
      );
    });
  });
});
