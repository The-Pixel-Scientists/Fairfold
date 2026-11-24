// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Retention of form responses (migration 0113): app.apply_retention(
// 'forms_responses') deletes respondent tokens a day past their expiry, then
// submitted responses a day past their retain_until that no token refers
// to, in the tenant set alone, with one event for each target it deletes
// from. It keeps younger responses and drafts. Even its owner cannot delete
// a response or token inside its time.

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { asMigratorIn, createTestTenant, insertRow, type TestTenant } from '../tenants.ts';
import { addFormsParts, anonymousRow, responseRow, tokenRow, type FormsParts } from './fixtures.ts';

interface Tenant {
  readonly tenant: TestTenant;
  readonly parts: FormsParts;
}

async function newTenant(): Promise<Tenant> {
  const tenant = await createTestTenant();
  return {
    tenant,
    parts: await asMigratorIn(tenant.id, (client) => addFormsParts(client, tenant)),
  };
}

/** Move a response's retain_until, and its token's expiry, `days` into the past, as migrator. */
async function age(client: pg.ClientBase, response: string, days: number): Promise<void> {
  await client.query('ALTER TABLE forms.response DISABLE TRIGGER keep_response');
  await client.query(
    'UPDATE forms.response SET retain_until = now() - make_interval(days => $2) WHERE id = $1',
    [response, days],
  );
  await client.query('ALTER TABLE forms.response ENABLE TRIGGER keep_response');
  await client.query(
    'UPDATE forms.respondent_token SET expires_at = now() - make_interval(days => $2) WHERE response_id = $1',
    [response, days],
  );
}

/** A signed-in response and an anonymous one with its token, each `days` past its time. */
async function responsesAged({ tenant, parts }: Tenant, days: number) {
  return asMigratorIn(tenant.id, async (client) => {
    const signedIn = await insertRow(client, 'forms.response', responseRow(tenant, parts));
    const anonymous = await insertRow(client, 'forms.response', anonymousRow(tenant, parts));
    const token = await insertRow(client, 'forms.respondent_token', tokenRow(tenant, anonymous));
    await age(client, signedIn, days);
    await age(client, anonymous, days);
    return { signedIn, anonymous, token };
  });
}

/** Every row app.apply_retention('forms_responses') returns, called as app_worker and committed. */
function apply({ tenant }: Tenant) {
  return withClient('app_worker', async (client) => {
    await client.query('BEGIN');
    await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
    const { rows } = await client.query<{ target: string; deleted: number }>(
      "SELECT target, deleted FROM app.apply_retention('forms_responses')",
    );
    await client.query('COMMIT');
    return rows;
  });
}

/** Which of `ids` are still in `table`, as migrator. */
async function present({ tenant }: Tenant, table: string, ids: readonly string[]) {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY ($1::uuid[])`, [ids]),
  );
  return ids.filter((id) => rows.some((row) => row.id === id));
}

async function events({ tenant }: Tenant) {
  const { rows } = await asMigratorIn(tenant.id, (client) =>
    client.query<{ changes: unknown }>(
      `SELECT changes FROM app.audit_event
        WHERE action = 'platform.retention.applied' ORDER BY occurred_at, changes ->> 'target'`,
    ),
  );
  return rows.map(({ changes }) => changes);
}

describe("app.apply_retention('forms_responses')", { timeout: 120_000 }, () => {
  it('deletes tokens, then responses, a day past their time, in the tenant set alone', async () => {
    const [a, b] = [await newTenant(), await newTenant()];
    const expired = await responsesAged(a, 2);
    const young = await responsesAged(a, 0);
    const other = await responsesAged(b, 2);
    const draft = await asMigratorIn(a.tenant.id, (client) =>
      insertRow(client, 'forms.response', responseRow(a.tenant, a.parts, { status: 'draft' })),
    );

    expect(await apply(a)).toEqual([
      { target: 'forms.respondent_token', deleted: 1 },
      { target: 'forms.response', deleted: 2 },
    ]);
    expect(await apply(a)).toEqual([
      { target: 'forms.respondent_token', deleted: 0 },
      { target: 'forms.response', deleted: 0 },
    ]);
    expect(await present(a, 'forms.respondent_token', [expired.token, young.token])).toEqual([
      young.token,
    ]);
    expect(
      await present(a, 'forms.response', [
        expired.signedIn,
        expired.anonymous,
        young.signedIn,
        young.anonymous,
        draft,
      ]),
    ).toEqual([young.signedIn, young.anonymous, draft]);
    expect(await present(b, 'forms.response', [other.signedIn, other.anonymous])).toHaveLength(2);
    expect(await events(a)).toEqual([
      { policy: 'forms_responses', target: 'forms.respondent_token', deleted: 1 },
      { policy: 'forms_responses', target: 'forms.response', deleted: 2 },
    ]);
    expect(await events(b)).toEqual([]);
  });

  it('keeps a response while its token is still there', async () => {
    const a = await newTenant();
    const { anonymous, token } = await responsesAged(a, 2);
    await asMigratorIn(a.tenant.id, (client) =>
      client.query('UPDATE forms.respondent_token SET expires_at = now() WHERE response_id = $1', [
        anonymous,
      ]),
    );
    expect(await apply(a)).toEqual([
      { target: 'forms.respondent_token', deleted: 0 },
      { target: 'forms.response', deleted: 1 },
    ]);
    expect(await present(a, 'forms.response', [anonymous])).toEqual([anonymous]);
    expect(await present(a, 'forms.respondent_token', [token])).toEqual([token]);
  });

  it('holds even its owner to rows past their time', async () => {
    const a = await newTenant();
    const young = await responsesAged(a, 0);
    await withClient('migrator', async (client: pg.ClientBase) => {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [
          a.tenant.id,
        ]);
        await client.query('SET LOCAL ROLE owner_app_apply_retention');
        const tokens = await client.query('DELETE FROM forms.respondent_token WHERE id = $1', [
          young.token,
        ]);
        const responses = await client.query('DELETE FROM forms.response WHERE id = $1', [
          young.signedIn,
        ]);
        expect([tokens.rowCount, responses.rowCount]).toEqual([0, 0]);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
