// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.document_template_version (migration 0100): denied across tenants,
// immutable for every role, its checks in step with the contracts in
// packages/domain/src/documents, and its creation time set by the database.

import { documentKinds } from '@pixel-scientists/domain/documents';
import { projectionAudiences } from '@pixel-scientists/domain/forms';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';
import { templateRow } from './fixtures.ts';

const TABLE = 'app.document_template_version';

let tenant: TestTenant;
let member: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}, 30_000);

const insert = (change: Record<string, unknown>) =>
  insertOutcome('app_api', tenant, TABLE, templateRow(tenant, member, change));

describe(TABLE, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, row) =>
      templateRow(row, await addMember(client, row)),
    ));

  it('checks exactly the kinds and audiences of the contracts', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query<{ name: string; definition: string }>(
        `SELECT conname AS name, pg_catalog.pg_get_constraintdef(oid) AS definition
           FROM pg_catalog.pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`,
        [TABLE],
      ),
    );
    const literals = (name: string) =>
      [...(rows.find((row) => row.name === name)?.definition ?? '').matchAll(/'([^']*)'::text/g)]
        .map((match) => match[1])
        .sort();
    expect(literals('document_template_version_kind_check')).toEqual([...documentKinds].sort());
    expect(literals('document_template_version_audience_check')).toEqual(
      [...projectionAudiences].sort(),
    );
  });

  it('takes a version as app_api, setting its creation time', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        TABLE,
        templateRow(tenant, member, { version: 2, created_at: new Date('2020-01-01') }),
      ),
    );
    const { rows } = await asMigratorIn(tenant.id, (client) =>
      client.query<{ recent: boolean }>(
        `SELECT created_at > now() - interval '1 minute' AS recent FROM ${TABLE} WHERE id = $1`,
        [id],
      ),
    );
    expect(rows[0]?.recent).toBe(true);
    expect(await insert({ version: 3 })).toBe('ok');
  });

  it.each([
    ['a version below 1', { version: 0 }],
    ['an unknown kind', { kind: 'letter' }],
    ['an unknown audience', { audience: 'public' }],
    ['an empty title', { title: '' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['a title with a control character', { title: 'Board\u0007pack' }],
    ['a title with a format character', { title: 'Board\u202epack' }],
    ['a merge field that is not a field id', { merge_fields: ['name'] }],
    ['a null merge field', { merge_fields: [null] }],
    ['more than 200 merge fields', { merge_fields: Array(201).fill('f_a') }],
    ['a body that is not an array', { body: JSON.stringify({ type: 'page_break' }) }],
    ['an empty body', { body: '[]' }],
    ['more than 500 blocks', { body: JSON.stringify(Array(501).fill({ type: 'page_break' })) }],
    [
      'a body over its size cap',
      { body: JSON.stringify([{ type: 'heading', level: 1, text: 'x'.repeat(400_000) }]) },
    ],
  ])('refuses %s', async (_name, change) => {
    expect(await insert(change)).toBe('23514');
  });

  it('allows no merge fields', async () => {
    expect(await insert({ version: 4, merge_fields: [] })).toBe('ok');
  });

  it('refuses a second version with the same number', async () => {
    const template = '00000000-0000-4000-8000-000000000002';
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, templateRow(tenant, member, { template_id: template })),
    );
    expect(await insert({ template_id: template })).toBe('23505');
  });

  it('refuses every role an update or a delete', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, templateRow(tenant, member, { version: 5 })),
    );
    await expectEveryRoleRefused(tenant, `UPDATE ${TABLE} SET title = 'Changed' WHERE id = $1`, [
      id,
    ]);
    await expectEveryRoleRefused(tenant, `DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  });
});
