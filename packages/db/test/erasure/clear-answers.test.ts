// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.clear_answer_fields() (migration 0033, ADR 0027 "Form answers"):
// only app_worker may call it, in a tenant, on an application of that
// tenant whose applicant is erased. It removes exactly the listed answers,
// even from a submitted application, keeps every other answer and column,
// and changes nothing elsewhere.

import { beforeAll, describe, expect, it } from 'vitest';

import { addParts, applicationRow, submit } from '../grants/application-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addErasureRequest, callAs, CLEAR, erase, rowsOf } from './fixtures.ts';

const ANSWERS = { f_name: 'Ada’s garden', f_budget: 1200 };

let tenant: TestTenant;
let other: TestTenant;
let application: string;
let person: string;
let request: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    person = parts.person;
    application = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
    await client.query('UPDATE grants.application SET answers = $2 WHERE id = $1', [
      application,
      JSON.stringify(ANSWERS),
    ]);
    await submit(client, application, parts.stages[0]);
    request = await addErasureRequest(client, tenant, await addMember(client, tenant), person);
  });
}, 60_000);

const answers = async () => (await rowsOf(tenant, 'grants.application', 'id', application))[0];

describe('grants.clear_answer_fields', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_auth', 'app_queue'] as const)('cannot be called by %s', async (role) => {
    expect((await callAs(role, tenant, CLEAR, [application, ['f_name']])).code).toBe('42501');
  });

  it('needs a tenant', async () => {
    const result = await callAs('app_worker', undefined, CLEAR, [application, ['f_name']]);
    expect(result.code).toBe('55000');
  });

  it('refuses while the applicant is not erased', async () => {
    const result = await callAs('app_worker', tenant, CLEAR, [application, ['f_name']]);
    expect(result.code).toBe('55000');
    expect(await answers()).toMatchObject({ answers: ANSWERS });
  });

  it.each([
    ['no field ids', []],
    ['a column field id', ['party.person.email']],
    ['a null', [null]],
    ['two dimensions', [['f_name']]],
  ])('refuses %s', async (_, fieldIds) => {
    expect((await callAs('app_worker', tenant, CLEAR, [application, fieldIds])).code).toBe('22023');
  });

  it('cannot clear another tenant’s application', async () => {
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    expect((await callAs('app_worker', other, CLEAR, [application, ['f_name']])).code).toBe(
      '55000',
    );
    expect(await answers()).toMatchObject({ answers: ANSWERS });
  });

  it('removes exactly the listed answers once the applicant is erased', async () => {
    const before = await answers();
    const fields = ['f_name', 'f_unknown'];
    expect((await callAs('app_worker', tenant, CLEAR, [application, fields])).row).toEqual({
      cleared: 1,
    });
    const after = await answers();
    expect(after).toEqual({
      ...before,
      answers: { f_budget: 1200 },
      updated_at: expect.any(Date) as Date,
    });
    expect((await callAs('app_worker', tenant, CLEAR, [application, fields])).row).toEqual({
      cleared: 0,
    });
  });

  it('still refuses app_api a change to submitted answers', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const change = "UPDATE grants.application SET answers = '{}' WHERE id = $1";
      expect(await outcome(client, change, [application])).toBe('55000');
    });
  });
});
