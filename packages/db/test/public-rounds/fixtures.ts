// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for grants.public_open_rounds() (migration 0071): a tenant with
// grants switched on, and open rounds in it, each one field away from
// hidden. Every row is committed as migrator with the tenant set.

import type pg from 'pg';

import { withClient } from '../connect.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';

export interface GrantsTenant extends TestTenant {
  readonly member: string;
}

/** A form with two eligibility questions between ordinary ones. */
export const DEFINITION = {
  sections: [
    {
      id: 'about',
      title: 'About you',
      fields: [
        { id: 'name', type: 'short_text', label: 'Organisation name', hint: 'As registered' },
        {
          id: 'charity',
          type: 'yes_no',
          label: 'Are you a registered charity?',
          hint: 'Hint stays private',
          eligibility: { stopWhen: false, explanation: 'Only registered charities can apply.' },
        },
      ],
    },
    {
      id: 'work',
      title: 'Your work',
      fields: [
        {
          id: 'area',
          type: 'single_choice',
          label: 'Where do you work?',
          options: [
            { value: 'north', label: 'North' },
            { value: 'elsewhere', label: 'Elsewhere' },
          ],
          eligibility: { stopValues: ['elsewhere'], explanation: 'This round funds the north.' },
        },
        { id: 'budget', type: 'number', label: 'How much do you need?' },
      ],
    },
  ],
};

export const ELIGIBILITY = [
  { label: 'Are you a registered charity?', explanation: 'Only registered charities can apply.' },
  { label: 'Where do you work?', explanation: 'This round funds the north.' },
];

/** A tenant with a member and, unless `switchedOn` is false, grants switched on. */
export async function createGrantsTenant(switchedOn = true): Promise<GrantsTenant> {
  const tenant = await createTestTenant();
  const member = await asMigratorIn(tenant.id, async (client) => {
    const id = await addMember(client, tenant);
    if (switchedOn) {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module: 'grants',
        enabled: true,
        updated_by: id,
      });
    }
    return id;
  });
  return { ...tenant, member };
}

/** Publish `definition` as the next version of `round`'s form. */
export function publishForm(
  client: pg.ClientBase,
  tenant: GrantsTenant,
  round: string,
  version: number,
  definition: unknown = DEFINITION,
): Promise<string> {
  return insertRow(client, 'grants.form_version', {
    tenant_id: tenant.id,
    round_id: round,
    version,
    status: 'published',
    definition,
    published_at: new Date(),
    published_by: tenant.member,
  });
}

/**
 * An open programme with an open round and, unless `form` is null, a
 * published form version. `round` changes the round's columns.
 */
export async function addOpenRound(
  tenant: GrantsTenant,
  round: Row = {},
  form: unknown = DEFINITION,
): Promise<string> {
  return asMigratorIn(tenant.id, async (client) => {
    const programme = await insertRow(client, 'grants.programme', {
      tenant_id: tenant.id,
      title: 'Programme A',
      summary: 'Grants for synthetic test groups.',
      description: 'Private description text',
      status: 'open',
    });
    const id = await insertRow(client, 'grants.round', {
      tenant_id: tenant.id,
      programme_id: programme,
      title: 'Round 1',
      opens_at: new Date(Date.now() - 10 * 86_400_000),
      closes_at: new Date(Date.now() + 10 * 86_400_000),
      timezone: 'Europe/London',
      budget_minor: 9_876_543,
      award_min_minor: 10_000,
      award_max_minor: 500_000,
      late_policy: 'accept_and_flag',
      ...round,
    });
    if (form !== null) await publishForm(client, tenant, id, 1, form);
    return id;
  });
}

/** Run `text` as migrator in `tenant` and commit it. */
export function changeIn(tenant: TestTenant, text: string, values: unknown[] = []): Promise<void> {
  return asMigratorIn(tenant.id, async (client) => {
    await client.query(text, values);
  });
}

/** The function's rows for `slug` as app_api, with `context` set as the tenant if given. */
export function openRounds(slug: string | null, context?: string): Promise<Row[]> {
  return withClient('app_api', async (client) => {
    await client.query('BEGIN');
    try {
      if (context) {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [context]);
      }
      const { rows } = await client.query<Row>('SELECT * FROM grants.public_open_rounds($1)', [
        slug,
      ]);
      return rows;
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

/** The round ids `slug` lists. */
export async function roundIds(slug: string | null, context?: string): Promise<unknown[]> {
  return (await openRounds(slug, context)).map((row) => row['round_id']);
}
