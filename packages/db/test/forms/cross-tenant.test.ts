// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant denial for every forms table (architecture rule 2), and each
// composite foreign key refusing another tenant's person, membership,
// configuration version, form, version or response.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addConfigVersion,
  addFormsParts,
  anonymousRow,
  draftRow,
  formRow,
  insertOutcome,
  responseRow,
  tokenRow,
  type FormsParts,
} from './fixtures.ts';

const newForm = async (client: pg.ClientBase, tenant: TestTenant, member: string) =>
  insertRow(client, 'forms.form', formRow(tenant, member));

// Each factory adds no other row to the table under test, so the blind
// statements meet one row a tenant.
const FACTORIES: Readonly<Record<string, RowFactory>> = {
  'forms.form': async (client, tenant) => formRow(tenant, await addMember(client, tenant)),
  'forms.form_version': async (client, tenant) => {
    const member = await addMember(client, tenant);
    return draftRow(tenant, await newForm(client, tenant, member), member);
  },
  'forms.response': async (client, tenant) =>
    responseRow(tenant, await addFormsParts(client, tenant)),
  'forms.respondent_token': async (client, tenant) => {
    const parts = await addFormsParts(client, tenant);
    return tokenRow(tenant, await insertRow(client, 'forms.response', anonymousRow(tenant, parts)));
  },
};

describe('forms cross-tenant denial', { timeout: 120_000 }, () => {
  it.each(Object.keys(FACTORIES))('%s', (table) =>
    expectCrossTenantDenial(table, FACTORIES[table] as RowFactory),
  );
});

describe('forms foreign keys across tenants', { timeout: 60_000 }, () => {
  let a: TestTenant;
  let own: FormsParts & { bare: string; draft: string; response: string; token: string };
  let other: FormsParts & { config: string; anonymous: string };

  beforeAll(async () => {
    a = await createTestTenant();
    own = await asMigratorIn(a.id, async (client) => {
      const parts = await addFormsParts(client, a);
      const response = await insertRow(client, 'forms.response', anonymousRow(a, parts));
      return {
        ...parts,
        bare: await insertRow(client, 'forms.form', formRow(a, parts.member)),
        draft: await insertRow(
          client,
          'forms.form_version',
          draftRow(a, parts.form, parts.member, { version: 2 }),
        ),
        response,
        token: await insertRow(client, 'forms.respondent_token', tokenRow(a, response)),
      };
    });
    const b = await createTestTenant();
    other = await asMigratorIn(b.id, async (client) => {
      const parts = await addFormsParts(client, b);
      return {
        ...parts,
        config: await addConfigVersion(client, b, parts.form, parts.member),
        anonymous: await insertRow(client, 'forms.response', anonymousRow(b, parts)),
      };
    });
  });

  it("refuse another tenant's membership, form, version or person on insert", async () => {
    // A submitted response reads its form's retention first, and a form it
    // cannot see fails the submitted check, so the form case uses a draft.
    const DRAFT = { status: 'draft' };
    const cases: [string, string, Record<string, unknown>][] = [
      ['membership', 'forms.form', formRow(a, other.member)],
      ['form', 'forms.form_version', draftRow(a, other.form, own.member, { version: 9 })],
      ['membership', 'forms.form_version', draftRow(a, own.bare, other.member)],
      ['form', 'forms.response', responseRow(a, { ...own, form: other.form }, DRAFT)],
      ['version', 'forms.response', responseRow(a, { ...own, version: other.version })],
      ['person', 'forms.response', responseRow(a, { ...own, person: other.person })],
      ['membership', 'forms.response', responseRow(a, { ...own, member: other.member })],
    ];
    for (const [kind, table, row] of cases) {
      expect(await insertOutcome('app_api', a, table, row), `${table} with B's ${kind}`).toBe(
        '23503',
      );
    }
  });

  it("refuse another tenant's configuration version, membership or response on update", async () => {
    await asRoleIn('app_api', a.id, async (client) => {
      const publish = `UPDATE forms.form_version
                          SET status = 'published', published_by = $1, config_version_id = $2
                        WHERE id = $3`;
      expect(await outcome(client, publish, [own.member, other.config, own.draft])).toBe('23503');
      expect(
        await outcome(
          client,
          'UPDATE forms.response SET spam_reason = $1, spam_marked_by = $2 WHERE id = $3',
          ['test', other.member, own.response],
        ),
      ).toBe('23503');
      expect(
        await outcome(
          client,
          'UPDATE forms.respondent_token SET revoked_at = now(), revoked_by = $1 WHERE id = $2',
          [other.member, own.token],
        ),
      ).toBe('23503');
    });
    // A token for another tenant's response finds no response to belong to.
    expect(
      await asMigratorIn(a.id, (client: pg.ClientBase) =>
        outcome(
          client,
          'INSERT INTO forms.respondent_token (tenant_id, response_id, token_hash) VALUES ($1, $2, $3)',
          [a.id, other.anonymous, Buffer.alloc(32, 1)],
        ),
      ),
    ).toBe('23514');
  });
});
