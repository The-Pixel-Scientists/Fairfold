// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.monitoring_visit, assure.visit_attendee and assure.visit_evidence
// (migration 0057): denied across tenants; a visit stays with its
// organisation and application, its findings and follow-ups checked; an
// attendee is a person of the tenant, once per visit; evidence links a clean
// file of the tenant once, and its caption changes in place.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addVisit, visitRow } from './fixtures.ts';

let tenant: TestTenant;
let member: string;
let organisation: string;
let visit: string;
let person: string;
let strangers: {
  member: string;
  organisation: string;
  application: string;
  visit: string;
  person: string;
  file: string;
};

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    ({ member, organisation, visit } = await addVisit(client, tenant));
    person = await addPerson(client, tenant);
  });
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const made = await addVisit(client, stranger);
    return {
      ...made,
      application: (await addApplication(client, stranger)).id,
      person: await addPerson(client, stranger),
      file: await addFile(client, stranger, made.member),
    };
  });
}, 60_000);

describe('assure.monitoring_visit', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.monitoring_visit', async (client, row) =>
      visitRow(row, await addOrganisation(client, row), await addMember(client, row)),
    ));

  it("refuses another tenant's organisation, application or member", async () => {
    const insert = (change: Record<string, unknown>) =>
      insertOutcome(
        'app_api',
        tenant,
        'assure.monitoring_visit',
        visitRow(tenant, organisation, member, change),
      );
    expect(await insert({ organisation_id: strangers.organisation })).toBe('23503');
    expect(await insert({ application_id: strangers.application })).toBe('23503');
    expect(await insert({ recorded_by: strangers.member })).toBe('23503');
    expect(await insert({ findings: '' })).toBe('ok');
  });

  it.each([
    ['an unknown visit type', { visit_type: 'site_walk' }],
    ['findings over the limit', { findings: 'x'.repeat(10_001) }],
    ['findings with a control character', { findings: 'Line\u0007bell' }],
    ['follow-ups that are not a list', { follow_ups: JSON.stringify({ action: 'Call' }) }],
    ['a follow-up with no action', { follow_ups: JSON.stringify([{ dueOn: null, done: false }]) }],
  ])('refuses %s', async (_name, change) => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.monitoring_visit',
        visitRow(tenant, organisation, member, change),
      ),
    ).toBe('23514');
  });

  it('keeps findings over several lines', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.monitoring_visit',
        visitRow(tenant, organisation, member, { findings: 'First line\nSecond line' }),
      ),
    ).toBe('ok');
  });

  it('stays with its organisation and application', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const column of ['organisation_id', 'application_id', 'recorded_by']) {
        expect(
          await outcome(
            client,
            `UPDATE assure.monitoring_visit SET ${column} = ${column} WHERE id = $1`,
            [visit],
          ),
          column,
        ).toBe('42501');
      }
      const { rows } = await client.query<{ updated_at: Date }>(
        `UPDATE assure.monitoring_visit SET findings = 'Revised', updated_by = $2
          WHERE id = $1 RETURNING updated_at`,
        [visit, member],
      );
      expect(rows[0]?.updated_at).toBeInstanceOf(Date);
    });
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.monitoring_visit WHERE id = $1', [
      visit,
    ]);
  });
});

describe('assure.visit_attendee', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.visit_attendee', async (client, row) => ({
      tenant_id: row.id,
      visit_id: (await addVisit(client, row)).visit,
      person_id: await addPerson(client, row),
    })));

  it("refuses another tenant's visit or person, and a person twice", async () => {
    const insert = (change: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'assure.visit_attendee', {
        tenant_id: tenant.id,
        visit_id: visit,
        person_id: person,
        ...change,
      });
    expect(await insert({ visit_id: strangers.visit })).toBe('23503');
    expect(await insert({ person_id: strangers.person })).toBe('23503');
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'assure.visit_attendee', {
        tenant_id: tenant.id,
        visit_id: visit,
        person_id: person,
      }),
    );
    expect(await insert({})).toBe('23505');
  });

  it('is never changed in place', async () => {
    await expectEveryRoleRefused(
      tenant,
      'UPDATE assure.visit_attendee SET person_id = person_id WHERE visit_id = $1',
      [visit],
    );
  });
});

describe('assure.visit_evidence', { timeout: 30_000 }, () => {
  const evidenceRow = (file: string, change: Record<string, unknown> = {}) => ({
    tenant_id: tenant.id,
    visit_id: visit,
    file_id: file,
    caption: 'Synthetic caption',
    added_by: member,
    ...change,
  });

  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.visit_evidence', async (client, row) => {
      const made = await addVisit(client, row);
      return {
        tenant_id: row.id,
        visit_id: made.visit,
        file_id: await addFile(client, row, made.member),
        caption: 'Synthetic caption',
        added_by: made.member,
      };
    }));

  it('refuses a file or visit from another tenant, and a blank caption', async () => {
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member));
    const insert = (row: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'assure.visit_evidence', row);
    expect(await insert(evidenceRow(strangers.file))).toBe('23503');
    expect(await insert(evidenceRow(file, { visit_id: strangers.visit }))).toBe('23503');
    expect(await insert(evidenceRow(file, { caption: ' ' }))).toBe('23514');
    expect(await insert(evidenceRow(file))).toBe('ok');
  });

  it('links a file once and changes its caption in place', async () => {
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, member));
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'assure.visit_evidence', evidenceRow(file));
      const { rowCount } = await client.query(
        "UPDATE assure.visit_evidence SET caption = 'Revised caption' WHERE file_id = $1",
        [file],
      );
      expect(rowCount).toBe(1);
      expect(
        await outcome(
          client,
          'UPDATE assure.visit_evidence SET file_id = file_id WHERE file_id = $1',
          [file],
        ),
      ).toBe('42501');
      const { rows } = await client.query<{ linked_at: Date | null }>(
        'SELECT linked_at FROM app.file WHERE id = $1',
        [file],
      );
      expect(rows[0]?.linked_at).toBeInstanceOf(Date);
    });
  });
});
