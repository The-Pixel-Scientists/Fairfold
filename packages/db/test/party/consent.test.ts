// SPDX-License-Identifier: AGPL-3.0-or-later
//
// party.consent (migration 0005): isolation, append-only for app_api with
// the time set by the database, a person at every row, and the checks on
// each column.

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
import { addOrganisation, addPerson } from './fixtures.ts';

/** A tenant with a member, a person and an organisation, and a member of another tenant. */
let tenant: TestTenant;
let member: string;
let stranger: string;
let person: string;
let organisation: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  [member, person, organisation] = await asMigratorIn(tenant.id, async (client) => [
    await addMember(client, tenant),
    await addPerson(client, tenant),
    await addOrganisation(client, tenant),
  ]);
  stranger = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 30_000);

function consent(change: Row = {}): Row {
  return {
    tenant_id: tenant.id,
    person_id: person,
    purpose: 'future_funding',
    channel: 'email',
    state: 'given',
    privacy_notice_version: '2026-10.1',
    source: 'portal',
    recorded_by: member,
    ...change,
  };
}

describe('party.consent', { timeout: 30_000 }, () => {
  it("keeps each tenant's consent records from every other tenant", async () => {
    await expectCrossTenantDenial('party.consent', async (client, owner) => ({
      tenant_id: owner.id,
      person_id: await addPerson(client, owner),
      purpose: 'future_funding',
      channel: 'post',
      state: 'withdrawn',
      privacy_notice_version: 'v1',
      source: 'staff',
      recorded_by: await addMember(client, owner),
    }));
  });

  it('lets app_api add and read consent changes, but never change or remove one', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const state of ['given', 'withdrawn']) {
        const { text, values } = insertStatement(client, 'party.consent', consent({ state }));
        await client.query(text, values);
      }
      const { rows } = await client.query(
        `SELECT state, recorded_at > now() AS clocked FROM party.consent
          ORDER BY recorded_at DESC`,
      );
      expect(rows).toEqual([
        { state: 'withdrawn', clocked: true },
        { state: 'given', clocked: true },
      ]);

      for (const change of [
        "state = 'given'",
        'recorded_at = now()',
        'recorded_by = recorded_by',
      ]) {
        expect(await outcome(client, `UPDATE party.consent SET ${change}`), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM party.consent')).toBe('42501');
      const backdated = insertStatement(
        client,
        'party.consent',
        consent({ recorded_at: new Date(0) }),
      );
      expect(await outcome(client, backdated.text, backdated.values)).toBe('42501');
    });
  });

  it.each([
    ['accepts each channel', { channel: 'sms' }, 'ok'],
    ['accepts a change by staff', { source: 'staff' }, 'ok'],
    ['refuses an organisation in place of a person', { person_id: '<organisation>' }, '23503'],
    ['refuses an unknown purpose', { purpose: 'newsletter' }, '23514'],
    ['refuses an unknown channel', { channel: 'fax' }, '23514'],
    ['refuses an unknown state', { state: 'maybe' }, '23514'],
    ['refuses an unknown source', { source: 'import' }, '23514'],
    ['refuses an empty notice version', { privacy_notice_version: '' }, '23514'],
    ['refuses a notice version with a space', { privacy_notice_version: 'v 1' }, '23514'],
    ['refuses no recorder', { recorded_by: null }, '23502'],
    ['refuses a recorder from another tenant', { recorded_by: '<stranger>' }, '23503'],
  ])('%s', async (_, change: Row, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const ids: Readonly<Record<string, string>> = {
        '<organisation>': organisation,
        '<stranger>': stranger,
      };
      const resolved = Object.fromEntries(
        Object.entries(change).map(([column, value]) => [
          column,
          typeof value === 'string' ? (ids[value] ?? value) : value,
        ]),
      );
      const { text, values } = insertStatement(client, 'party.consent', consent(resolved));
      expect(await outcome(client, text, values)).toBe(expected);
    });
  });
});
