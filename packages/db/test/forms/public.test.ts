// SPDX-License-Identifier: AGPL-3.0-or-later
//
// forms.submit_public_response (migration 0079, ADR 0036), called as app_api
// with no tenant set: every not-found case and every version it does not
// take write nothing; a submission writes one response pinned to exactly
// the version answered, its token and its audit event; a key replays or is
// refused; two identical calls in flight leave one response; only an id or
// a code comes back; and its owner holds nothing beyond its grants.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addFormsParts,
  draftRow,
  formRow,
  hash,
  publishVersion,
  submit,
  SUBMIT,
  submitValues,
  switchFormsOn,
  type FormsParts,
  type Submission,
} from './fixtures.ts';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

let a: TestTenant;
let b: TestTenant;
let partsA: FormsParts;
let partsB: FormsParts;
/** Form ids by case, each in tenant A. */
const forms: Record<string, string> = {};
let draftA: string;
let signedInVersion: string;
let firstVersion: string;
let secondVersion: string;
let pinnedForm: string;

beforeAll(async () => {
  a = await createTestTenant();
  b = await createTestTenant();
  await asMigratorIn(a.id, async (client) => {
    await switchFormsOn(client, a);
    partsA = await addFormsParts(client, a);
    const form = (change: Record<string, unknown>) =>
      insertRow(client, 'forms.form', formRow(a, partsA.member, change));
    const published = async (change: Record<string, unknown>) => {
      const id = await form(change);
      await publishVersion(client, a, id, partsA.member);
      return id;
    };
    forms['signed-in only'] = await published({ respondents: 'signed_in' });
    forms['archived'] = await published({});
    await client.query('UPDATE forms.form SET archived_at = now() WHERE id = $1', [
      forms['archived'],
    ]);
    forms['closed'] = await published({ opens_at: iso(-2 * DAY), closes_at: iso(-DAY) });
    forms['not yet open'] = await published({ opens_at: iso(DAY) });
    forms['unpublished'] = await form({});
    draftA = await insertRow(
      client,
      'forms.form_version',
      draftRow(a, forms['unpublished'], partsA.member),
    );
    // Switched to anonymous after a signed-in publication, and not published since.
    forms['latest version signed-in'] = await published({ respondents: 'signed_in' });
    await client.query("UPDATE forms.form SET respondents = 'both' WHERE id = $1", [
      forms['latest version signed-in'],
    ]);
    // Published signed-in, then anyone, then once more.
    pinnedForm = await form({ respondents: 'signed_in' });
    signedInVersion = await publishVersion(client, a, pinnedForm, partsA.member);
    await client.query("UPDATE forms.form SET respondents = 'both' WHERE id = $1", [pinnedForm]);
    firstVersion = await publishVersion(client, a, pinnedForm, partsA.member, { version: 2 });
    secondVersion = await publishVersion(client, a, pinnedForm, partsA.member, { version: 3 });
  });
  await asMigratorIn(b.id, async (client) => {
    await switchFormsOn(client, b);
    partsB = await addFormsParts(client, b);
  });
}, 120_000);

const valid = (change: Partial<Submission> = {}): Submission => ({
  slug: a.slug,
  formId: partsA.form,
  formVersionId: partsA.version,
  ...change,
});

/** Responses and audit events in tenants A and B, as migrator. */
async function written(): Promise<number[]> {
  const count = (tenant: TestTenant) =>
    asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<{ responses: number; tokens: number; events: number }>(
        `SELECT (SELECT count(*)::int FROM forms.response) AS responses,
                (SELECT count(*)::int FROM forms.respondent_token) AS tokens,
                (SELECT count(*)::int FROM app.audit_event
                  WHERE action = 'forms.response.submitted') AS events`,
      );
      const [row] = rows;
      return row ? [row.responses, row.tokens, row.events] : [];
    });
  return [...(await count(a)), ...(await count(b))];
}

describe('forms.submit_public_response', { timeout: 120_000 }, () => {
  it('writes one submitted response pinned to the version, its token and its audit event', async () => {
    const tokenHash = hash();
    const requestId = randomUUID();
    const { response_id: id, code } = await submit(
      valid({ tokenHash, proofHash: null, requestId }),
    );
    expect(code).toBeNull();
    const state = await asMigratorIn(a.id, async (client) => {
      const one = async (text: string) =>
        (await client.query<Record<string, unknown>>(text, [id])).rows;
      return {
        response: await one(
          `SELECT form_id, form_version_id, route, status, respondent_person_id, proof_hash,
                  retain_until = submitted_at + interval '12 months' AS kept
             FROM forms.response WHERE id = $1`,
        ),
        token: await one(
          `SELECT t.token_hash, t.expires_at = r.retain_until AS ends
             FROM forms.respondent_token t JOIN forms.response r ON r.id = t.response_id
            WHERE t.response_id = $1`,
        ),
        event: await one(
          `SELECT request_id, actor_kind, actor_id, entity_type, subject_party_id, changes
             FROM app.audit_event WHERE entity_id = $1`,
        ),
      };
    });
    expect(state).toEqual({
      response: [
        {
          form_id: partsA.form,
          form_version_id: partsA.version,
          route: 'anonymous',
          status: 'submitted',
          respondent_person_id: null,
          proof_hash: null,
          kept: true,
        },
      ],
      token: [{ token_hash: tokenHash, ends: true }],
      event: [
        {
          request_id: requestId,
          actor_kind: 'system',
          actor_id: null,
          entity_type: 'forms.response',
          subject_party_id: null,
          changes: {
            'forms.response.form_id': { after: partsA.form },
            'forms.response.form_version_id': { after: partsA.version },
          },
        },
      ],
    });
  });

  it('answers not_found and writes nothing for every case it does not take', async () => {
    const suspended = await createTestTenant();
    const off = await createTestTenant();
    const none = await createTestTenant();
    const extra: Record<string, Submission> = {};
    for (const tenant of [suspended, off, none]) {
      await asMigratorIn(tenant.id, async (client) => {
        if (tenant !== none) await switchFormsOn(client, tenant, tenant !== off);
        const parts = await addFormsParts(client, tenant);
        extra[tenant.slug] = valid({
          slug: tenant.slug,
          formId: parts.form,
          formVersionId: parts.version,
        });
      });
    }
    await asMigratorIn(suspended.id, (client) =>
      client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [suspended.id]),
    );
    const cases: Record<string, Submission> = {
      'unknown slug': valid({ slug: 'test-no-such-tenant' }),
      'suspended tenant': extra[suspended.slug] as Submission,
      'forms switched off': extra[off.slug] as Submission,
      'forms never switched on': extra[none.slug] as Submission,
      'unknown form': valid({ formId: randomUUID() }),
      "A's slug with B's form": valid({ formId: partsB.form, formVersionId: partsB.version }),
      ...Object.fromEntries(
        Object.entries(forms).map(([name, formId]) => [name, valid({ formId })]),
      ),
    };
    const before = await written();
    for (const [name, submission] of Object.entries(cases)) {
      expect(await submit(submission), name).toEqual({ response_id: null, code: 'not_found' });
    }
    expect(await written()).toEqual(before);
  });

  it('pins exactly the version answered, and answers form_changed for any it does not take', async () => {
    const before = await written();
    const cases: Record<string, Submission> = {
      'a draft': valid({ formVersionId: draftA }),
      "another form's version": valid({ formVersionId: firstVersion }),
      "another tenant's version": valid({ formVersionId: partsB.version }),
      'a version for signed-in respondents': valid({
        formId: pinnedForm,
        formVersionId: signedInVersion,
      }),
    };
    for (const [name, submission] of Object.entries(cases)) {
      expect(await submit(submission), name).toEqual({ response_id: null, code: 'form_changed' });
    }
    expect(await written()).toEqual(before);

    const { response_id: id } = await submit(
      valid({ formId: pinnedForm, formVersionId: firstVersion }),
    );
    const pinned = await asMigratorIn(
      a.id,
      async (client) =>
        (
          await client.query<{ form_version_id: string }>(
            'SELECT form_version_id FROM forms.response WHERE id = $1',
            [id],
          )
        ).rows,
    );
    expect(pinned).toEqual([{ form_version_id: firstVersion }]);
    expect(secondVersion).not.toBe(firstVersion);
  });

  it('replays a key with the same request, and refuses one reused or a token or proof used before', async () => {
    const keyHash = hash();
    const requestHash = hash();
    const tokenHash = hash();
    const proofHash = hash();
    const first = await submit(valid({ keyHash, requestHash, tokenHash, proofHash }));
    const before = await written();
    expect(
      await submit(valid({ keyHash, requestHash, tokenHash: hash(), proofHash: hash() })),
    ).toEqual(first);
    const refused = {
      'the key with another request': valid({ keyHash, requestHash: hash() }),
      'the token with another key': valid({ tokenHash }),
      'the proof with another key': valid({ proofHash }),
    };
    expect(await submit(refused['the key with another request'])).toEqual({
      response_id: null,
      code: 'key_reused',
    });
    expect(await submit(refused['the token with another key'])).toEqual({
      response_id: null,
      code: 'key_reused',
    });
    expect(await submit(refused['the proof with another key'])).toEqual({
      response_id: null,
      code: 'proof_used',
    });
    expect(await written()).toEqual(before);
  });

  it('leaves one response for two identical calls in flight', async () => {
    const values = submitValues(valid());
    await withClient('app_api', (first) =>
      withClient('app_api', async (second) => {
        const pid = (
          await second.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid')
        ).rows[0]?.pid;
        await first.query('BEGIN');
        const one = (await first.query<{ response_id: string }>(SUBMIT, values)).rows[0];
        await second.query('BEGIN');
        const waiting = second.query<{ response_id: string; code: string | null }>(SUBMIT, values);
        await withClient('app_api', async (watcher) => {
          for (let tries = 0; tries < 100; tries += 1) {
            const { rows } = await watcher.query<{ waits: boolean }>(
              "SELECT wait_event_type = 'Lock' AS waits FROM pg_catalog.pg_stat_activity WHERE pid = $1",
              [pid],
            );
            if (rows[0]?.waits) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error('The second call never waited for the first.');
        });
        await first.query('COMMIT');
        const two = (await waiting).rows[0];
        await second.query('COMMIT');
        expect(two).toEqual({ response_id: one?.response_id, code: null });
      }),
    );
    const rows = await asMigratorIn(
      a.id,
      async (client) =>
        (
          await client.query<{ id: string }>(
            'SELECT id FROM forms.response WHERE idempotency_key_hash = $1',
            [values[5]],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
  });

  it('returns only a response id or a code, and runs for app_api alone', async () => {
    const outputs = await withClient('app_api', async (client) => {
      const { rows } = await client.query<{ name: string; type: string }>(
        `SELECT a.name, a.type::regtype::text AS type
           FROM pg_catalog.pg_proc p,
                unnest(p.proargnames, p.proallargtypes, p.proargmodes) AS a(name, type, mode)
          WHERE p.oid = 'forms.submit_public_response(text, uuid, uuid, jsonb, bytea, bytea, bytea, bytea, uuid)'::regprocedure
            AND a.mode = 'o'`,
      );
      return rows;
    });
    expect(outputs).toEqual([
      { name: 'response_id', type: 'uuid' },
      { name: 'code', type: 'text' },
    ]);
    for (const role of ['app_worker', 'app_auth', 'app_queue'] as const) {
      const code = await asRoleIn(role, a.id, (client) =>
        outcome(client, SUBMIT, submitValues(valid())),
      );
      expect(code, role).toBe('42501');
    }
  });

  it("holds nothing beyond its owner's grants", async () => {
    await asRoleIn('migrator', a.id, async (client: pg.Client) => {
      await client.query('SET LOCAL ROLE owner_forms_submit_public_response');
      const refused = [
        'SELECT answers FROM forms.response',
        'SELECT respondent_person_id FROM forms.response',
        'SELECT token_hash FROM forms.respondent_token',
        'SELECT definition FROM forms.form_version',
        'SELECT title FROM forms.form',
        'SELECT name FROM app.tenant',
        'SELECT id FROM party.person',
        'SELECT id FROM app.membership',
        'SELECT id FROM app.audit_event',
        "UPDATE forms.response SET status = 'submitted'",
        'DELETE FROM forms.response',
        'UPDATE forms.respondent_token SET revoked_at = now()',
        'DELETE FROM forms.form_version',
      ];
      for (const statement of refused)
        expect(await outcome(client, statement), statement).toBe('42501');
    });
  });
});
