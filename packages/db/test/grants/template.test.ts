// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.email_template_version (migration 0009): isolation, append-only
// for app_api with the time set by the database, one row per programme,
// outcome and version, and each check.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { addProgramme, templateRow } from './fixtures.ts';

/** A tenant with a member and a programme, and another tenant's member and programme. */
let tenant: TestTenant;
let member: string;
let programme: string;
let stranger: string;
let strangersProgramme: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, programme] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addProgramme(client, tenant),
  ]);
  [stranger, strangersProgramme] = await asMigratorIn(other.id, async (client) => [
    await addMember(client, other),
    await addProgramme(client, other),
  ]);
}, 30_000);

describe('grants.email_template_version', { timeout: 30_000 }, () => {
  it("keeps each tenant's template versions from every other tenant", async () => {
    await expectCrossTenantDenial('grants.email_template_version', async (client, owner) =>
      templateRow(owner, await addProgramme(client, owner)),
    );
  });

  it('lets app_api add and read versions, but never change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const version of [1, 2]) {
        const { text, values } = insertStatement(
          client,
          'grants.email_template_version',
          templateRow(tenant, programme, { version, created_by: member }),
        );
        await client.query(text, values);
      }
      const { rows } = await client.query(
        `SELECT version, created_at = now() AS stamped FROM grants.email_template_version
          WHERE programme_id = $1 ORDER BY version`,
        [programme],
      );
      expect(rows).toEqual([
        { version: 1, stamped: true },
        { version: 2, stamped: true },
      ]);

      for (const change of ["subject = 'Changed'", 'body = body', 'version = 3']) {
        expect(
          await outcome(client, `UPDATE grants.email_template_version SET ${change}`),
          change,
        ).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM grants.email_template_version')).toBe('42501');
      const backdated = insertStatement(
        client,
        'grants.email_template_version',
        templateRow(tenant, programme, { version: 3, created_at: new Date(0) }),
      );
      expect(await outcome(client, backdated.text, backdated.values)).toBe('42501');
    });
  });

  it('keeps one row for each programme, outcome and version', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const insert = (change: Row) =>
        insertStatement(
          client,
          'grants.email_template_version',
          templateRow(tenant, programme, change),
        );
      const first = insert({ version: 7 });
      await client.query(first.text, first.values);
      expect(await outcome(client, first.text, first.values)).toBe('23505');
      const declined = insert({ version: 7, outcome: 'declined' });
      expect(await outcome(client, declined.text, declined.values)).toBe('ok');
    });
  });

  it.each([
    ['accepts each outcome', { outcome: 'waitlisted' }, 'ok'],
    ['refuses an unknown outcome', { outcome: 'withdrawn' }, '23514'],
    ['refuses version 0', { version: 0 }, '23514'],
    ['refuses an empty subject', { subject: '' }, '23514'],
    ['refuses a subject over 150 characters', { subject: 'S'.repeat(151) }, '23514'],
    ['refuses a subject with a line break', { subject: 'Offer\nnow' }, '23514'],
    ['refuses an empty body', { body: '' }, '23514'],
    ['refuses a body over 5000 characters', { body: 'B'.repeat(5001) }, '23514'],
    ['refuses a body with a byte order mark', { body: '\ufeffDear applicant' }, '23514'],
    ['refuses no programme', { programme_id: null }, '23502'],
    ["refuses another tenant's programme", { programme_id: '<strangers programme>' }, '23503'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const ids: Readonly<Record<string, string>> = {
        '<stranger>': stranger,
        '<strangers programme>': strangersProgramme,
      };
      const values = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const statement = insertStatement(
        client,
        'grants.email_template_version',
        templateRow(tenant, programme, { version: 9, ...values }),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });
});
