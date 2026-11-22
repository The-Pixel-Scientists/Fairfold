// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Erasure of forms data (migration 0079, ADR 0027). forms.erase_subject runs
// only for app_worker, only for a party already erased in the transaction's
// tenant; it keeps only the answers the pinned version classifies public or
// internal, deletes nothing, leaves anonymous responses alone and, called
// again after a restore, clears the restored answers. An anonymous
// response, found by its id or reference, is erased by app_api clearing its
// answers and revoking its token, and the row stays.

import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import { addPerson } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';
import {
  addFormsParts,
  ANSWERS,
  anonymousRow,
  formRow,
  publishVersion,
  responseRow,
  SIGNED_IN_DEFINITION,
  tokenRow,
  type FormsParts,
} from './fixtures.ts';

const ERASE_FORMS = 'SELECT forms.erase_subject($1) AS counts';
const SPECIAL = { ...ANSWERS, f_health: true, f_unknown: 'Not a question' };
const KEPT = { f_rating: 4, f_venue: 'north' };

let tenant: TestTenant;
let parts: FormsParts;
let submitted: string;
let special: string;
let live: string;
let anonymous: string;
let token: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    parts = await addFormsParts(client, tenant);
    const signedIn = await insertRow(
      client,
      'forms.form',
      formRow(tenant, parts.member, { respondents: 'signed_in' }),
    );
    const version = await publishVersion(client, tenant, signedIn, parts.member, {
      definition: JSON.stringify(SIGNED_IN_DEFINITION),
    });
    submitted = await insertRow(client, 'forms.response', responseRow(tenant, parts));
    special = await insertRow(
      client,
      'forms.response',
      responseRow(
        tenant,
        { ...parts, form: signedIn, version },
        {
          status: 'draft',
          answers: JSON.stringify(SPECIAL),
        },
      ),
    );
    const other = await addPerson(client, tenant);
    live = await insertRow(
      client,
      'forms.response',
      responseRow(tenant, { ...parts, person: other }),
    );
    anonymous = await insertRow(client, 'forms.response', anonymousRow(tenant, parts));
    token = await insertRow(client, 'forms.respondent_token', tokenRow(tenant, anonymous));
  });
}, 60_000);

const clearForms = (inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_FORMS, [parts.person]);

const answers = () =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string; status: string; answers: unknown }>(
      'SELECT id, status, answers FROM forms.response WHERE id = ANY ($1)',
      [[submitted, special, live, anonymous]],
    );
    return Object.fromEntries(rows.map((row) => [row.id, [row.status, row.answers]]));
  });

const cleared = () => ({
  [submitted]: ['submitted', KEPT],
  [special]: ['draft', KEPT],
  [live]: ['submitted', ANSWERS],
  [anonymous]: ['submitted', ANSWERS],
});

describe('forms.erase_subject', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_FORMS, [parts.person])).code).toBe('42501');
    expect((await clearForms()).code).toBe('55000');
    expect((await clearForms(null)).code).toBe('55000');
  });

  it('keeps only public and internal answers, deletes nothing, and counts', async () => {
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, parts.member, parts.person),
    );
    expect((await erase(tenant, parts.person, request)).code).toBeUndefined();
    expect((await clearForms(await createTestTenant())).code).toBe('55000');

    const { row, code } = await clearForms();
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual({ 'forms.response': 2 });
    expect(await answers()).toEqual(cleared());
    expect((await clearForms()).row?.['counts']).toEqual({ 'forms.response': 0 });
  });

  it('clears the restored answers again after a restore', async () => {
    await asMigratorIn(tenant.id, async (client) => {
      await client.query('ALTER TABLE forms.response DISABLE TRIGGER keep_response');
      await client.query('UPDATE forms.response SET answers = $1 WHERE id = $2', [
        JSON.stringify(ANSWERS),
        submitted,
      ]);
      await client.query('UPDATE forms.response SET answers = $1 WHERE id = $2', [
        JSON.stringify(SPECIAL),
        special,
      ]);
      await client.query('ALTER TABLE forms.response ENABLE TRIGGER keep_response');
    });
    expect((await clearForms()).row?.['counts']).toEqual({ 'forms.response': 2 });
    expect(await answers()).toEqual(cleared());
  });

  it('refuses a new response from the erased person', async () => {
    const code = await asRoleIn('app_api', tenant.id, async (client) => {
      try {
        await client.query(
          `INSERT INTO forms.response (tenant_id, form_id, form_version_id, route,
                                       respondent_person_id, answers, created_by, updated_by)
           VALUES ($1, $2, $3, 'signed_in', $4, '{}', $5, $5)`,
          [tenant.id, parts.form, parts.version, parts.person, parts.member],
        );
        return 'ok';
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(code).toBe('55000');
  });
});

describe('erasing an anonymous response', { timeout: 30_000 }, () => {
  it('clears its personal answers and revokes its token, keeping the row', async () => {
    const after = await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query('UPDATE forms.response SET answers = $1, updated_by = $2 WHERE id = $3', [
        JSON.stringify(KEPT),
        parts.member,
        anonymous,
      ]);
      await client.query(
        'UPDATE forms.respondent_token SET revoked_at = now(), revoked_by = $1 WHERE id = $2',
        [parts.member, token],
      );
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT r.status, r.answers, t.revoked_at IS NOT NULL AS revoked
           FROM forms.response r JOIN forms.respondent_token t ON t.response_id = r.id
          WHERE r.id = $1`,
        [anonymous],
      );
      return rows;
    });
    expect(after).toEqual([{ status: 'submitted', answers: KEPT, revoked: true }]);
  });
});
