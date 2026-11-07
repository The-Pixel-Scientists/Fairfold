// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Idempotent create routes through their real replay readers (ADR 0028): the
// same key twice answers the same id and status, creates nothing and audits
// nothing more; and a replay shows no more than a fresh read would, so a
// caller who has lost access reads 404. Attachments and invitations are in
// attachments.integration.test.ts and team.integration.test.ts.

import { randomUUID } from 'node:crypto';

import type { Application } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import {
  complete,
  organisationBody,
  startApplicationsApi,
  type ApplicationsApi,
} from './applications-api.ts';
import { programmeBody, roundBody } from './programme-api.ts';
import type { Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: ApplicationsApi;

beforeAll(async () => {
  t = await startApplicationsApi('41034');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const count = async (table: string): Promise<number> =>
  Number((await t.rows<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]?.n);

const audited = (): Promise<number> => count('app.audit_event');

/**
 * Sends one create request twice with one key. Both answer 201 with the same
 * body, the first creates one row of `table`, and the replay changes neither
 * the table nor the audit log.
 */
async function sameTwice(
  member: Member,
  url: string,
  payload: unknown,
  table: string,
): Promise<{ id?: string }> {
  const key = randomUUID();
  const rowsBefore = await count(table);
  const first = await t.send(member, 'POST', url, payload, undefined, null, key);
  expect(first.statusCode, first.body).toBe(201);
  const rowsAfter = await count(table);
  const auditAfter = await audited();
  expect(rowsAfter).toBe(rowsBefore + 1);

  const second = await t.send(member, 'POST', url, payload, undefined, null, key);
  expect(second.statusCode, second.body).toBe(201);
  expect(second.json()).toEqual(first.json());
  expect(await count(table)).toBe(rowsAfter);
  expect(await audited()).toBe(auditAfter);
  return first.json<{ id?: string }>();
}

describe('replaying a create through the real reader', () => {
  it('programme, round and form draft', async () => {
    const programme = await sameTwice(
      t.managerA,
      '/console/programmes',
      programmeBody(),
      'grants.programme',
    );
    const round = await sameTwice(
      t.managerA,
      `/console/programmes/${programme.id}/rounds`,
      roundBody(),
      'grants.round',
    );
    await sameTwice(
      t.managerA,
      `/console/rounds/${round.id}/form-versions`,
      undefined,
      'grants.form_version',
    );
  });

  it('consent, which has no id', async () => {
    await sameTwice(
      t.ann,
      '/portal/profile/consents',
      {
        purpose: 'future_funding',
        channel: 'email',
        state: 'given',
        privacyNoticeVersion: '2026-10',
      },
      'party.consent',
    );
  });

  it('an organisation, and 404 once the caller is no longer its contact', async () => {
    const key = randomUUID();
    const send = () =>
      t.send(
        t.ann,
        'POST',
        '/portal/organisations',
        organisationBody('Replay Society'),
        undefined,
        null,
        key,
      );
    const first = await send();
    expect(first.statusCode).toBe(201);
    const { id } = first.json<{ id: string }>();
    const rows = await count('party.organisation');
    const auditAfter = await audited();

    const again = await send();
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(await count('party.organisation')).toBe(rows);
    expect(await audited()).toBe(auditAfter);

    await asMigratorIn(t.tenantA.id, (client) =>
      client.query('UPDATE party.relationship SET ends_on = current_date WHERE object_id = $1', [
        id,
      ]),
    );
    const read = await t.send(t.ann, 'GET', `/portal/organisations/${id}`);
    const replay = await send();
    expect(read.statusCode).toBe(404);
    expect(replay.statusCode).toBe(404);
    expectLooksMissing(replay, read);
    expect(replay.body).not.toContain('Replay Society');
    expect(await audited()).toBe(auditAfter);
  });

  it('an application: the replay equals the fresh portal read, and 404 once it is not the caller’s', async () => {
    const open = await t.openRound();
    const organisationId = await t.organisationOf(t.ann);
    const key = randomUUID();
    const send = (member: Member) =>
      t.send(member, 'POST', t.startPath(open.round.id), { organisationId }, undefined, null, key);
    const first = await send(t.ann);
    expect(first.statusCode, first.body).toBe(201);
    const draft = first.json<Application>();
    await t.saved(t.ann, draft, complete);
    const rows = await count('grants.application');
    const auditAfter = await audited();

    const fresh = await t.send(t.ann, 'GET', t.path(draft.id));
    const replay = await send(t.ann);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(fresh.json());
    expect(replay.json<Application>().answers).toEqual(complete);
    expect(await count('grants.application')).toBe(rows);
    expect(await audited()).toBe(auditAfter);

    // The key belongs to the member: another applicant's identical key starts nothing of Ann's.
    const other = await t.send(
      t.ben,
      'POST',
      t.startPath(open.round.id),
      { organisationId },
      undefined,
      null,
      key,
    );
    expect(other.statusCode).not.toBe(201);
    expect(other.body).not.toContain(draft.id);
  });
});
