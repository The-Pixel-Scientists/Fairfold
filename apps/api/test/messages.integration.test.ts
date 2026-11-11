// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages between an applicant and the funder through the whole API against
// the test database, as app_api, for two tenants: who may read and send, that
// the side and author come from the session, what each side sees and counts as
// unread, one thread per application, and what the tables and audit log hold
// (never a body).

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { switchModule } from './modules-on.ts';
import { MESSAGE, REPLY, startMessagesApi, type MessagesApi } from './messages-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: MessagesApi;

beforeAll(async () => {
  t = await startMessagesApi('41121');
}, 60_000);

afterAll(async () => {
  // Leave no waiting job for a worker started by a later test file to send.
  await t.rows("DELETE FROM pgboss.job WHERE name = 'grants.message_notification'");
  await t.close();
});

const threadsOf = (id: string) =>
  t.rows<{ thread_id: string }>(
    'SELECT thread_id FROM grants.application_message WHERE application_id = $1',
    [id],
  );

const messagesOf = (id: string) =>
  t.rows<{
    side: string;
    body: string;
    author_membership_id: string | null;
    author_person_id: string | null;
  }>(
    `SELECT m.side, m.body, m.author_membership_id, m.author_person_id
       FROM app.message m JOIN grants.application_message l ON l.thread_id = m.thread_id
      WHERE l.application_id = $1 ORDER BY m.created_at, m.id`,
    [id],
  );

const readTimes = async (id: string) =>
  (
    await t.rows<{ applicant_read_at: Date | null; staff_read_at: Date | null }>(
      `SELECT x.applicant_read_at, x.staff_read_at FROM app.message_thread x
         JOIN grants.application_message l ON l.thread_id = x.id WHERE l.application_id = $1`,
      [id],
    )
  )[0];

const personOf = async (id: string) =>
  (
    await t.rows<{ applicant_person_id: string }>(
      'SELECT applicant_person_id FROM grants.application WHERE id = $1',
      [id],
    )
  )[0]?.applicant_person_id;

describe('sending a message', () => {
  it('makes the thread with the first message, as the session’s person, and audits ids and the side only', async () => {
    const { id } = await t.submitted();
    const sent = await t.applicantSent(id);

    expect(sent).toMatchObject({ side: 'applicant', body: REPLY, unread: false });
    expect(await threadsOf(id)).toHaveLength(1);
    expect(await messagesOf(id)).toEqual([
      {
        side: 'applicant',
        body: REPLY,
        author_membership_id: null,
        author_person_id: await personOf(id),
      },
    ]);
    const [event] = await t.eventsOf<{ subject_party_id: string; changes: object }>(
      'grants.application.message_sent',
      id,
    );
    expect(event?.subject_party_id).toBe(await personOf(id));
    expect(JSON.stringify(event?.changes)).toContain(sent.id);
    expect(JSON.stringify(event?.changes)).not.toContain('Synthetic');
  });

  it('writes a funder message as the session’s member, and the applicant sees it from the funder alone', async () => {
    const { id } = await t.submitted();
    const sent = await answer<{ id: string; authorName: string | null; side: string }>(
      t.sendStaff(id, MESSAGE, t.ada),
      201,
    );

    expect(sent).toMatchObject({ side: 'staff', authorName: 'Ada Lovelace' });
    expect((await messagesOf(id))[0]).toMatchObject({
      side: 'staff',
      author_membership_id: t.ada.membershipId,
      author_person_id: null,
    });
    const thread = await t.applicantThread(id);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      id: sent.id,
      side: 'staff',
      body: MESSAGE,
      unread: true,
    });
    expect(Object.keys(thread.messages[0] ?? {}).sort()).toEqual([
      'body',
      'id',
      'sentAt',
      'side',
      'unread',
    ]);
    expect(JSON.stringify(thread)).not.toMatch(new RegExp(`Lovelace|${t.ada.membershipId}`));
  });

  it('takes no side, author or thread from the body, and refuses unwritable text', async () => {
    const { id } = await t.submitted();
    const refusals = await Promise.all([
      t.send(t.ann, 'POST', t.mine(id), { body: REPLY, side: 'staff' }, 'portal'),
      t.send(t.ann, 'POST', t.mine(id), { body: REPLY, authorId: t.ada.membershipId }, 'portal'),
      t.send(t.managerA, 'POST', t.staffPath(id), { body: MESSAGE, side: 'applicant' }),
      t.send(t.managerA, 'POST', t.staffPath(id), { body: MESSAGE, threadId: randomUUID() }),
      t.sendStaff(id, ' '),
      t.sendStaff(id, 'x'.repeat(2001)),
      t.sendStaff(id, 'Look at <b>this</b>'),
    ]);

    expect(refusals.map((response) => response.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400, 400,
    ]);
    expect(refusals[5].body).not.toContain('xxxx');
    expect(await threadsOf(id)).toEqual([]);
  });

  it('is idempotent: the same key makes one message and answers the same one', async () => {
    const { id } = await t.submitted();
    const key = randomUUID();
    const first = await answer<{ id: string }>(t.sendStaff(id, MESSAGE, t.managerA, key), 201);
    const again = await answer<{ id: string }>(t.sendStaff(id, MESSAGE, t.managerA, key), 201);

    expect(again.id).toBe(first.id);
    expect(await messagesOf(id)).toHaveLength(1);
    const applicantKey = randomUUID();
    const mine = await answer<{ id: string }>(t.sendApplicant(id, REPLY, t.ann, applicantKey), 201);
    const repeat = await answer<{ id: string }>(
      t.sendApplicant(id, REPLY, t.ann, applicantKey),
      201,
    );
    expect(repeat.id).toBe(mine.id);
    expect(await messagesOf(id)).toHaveLength(2);
  });

  it('leaves one thread when messages from both sides race to be first', async () => {
    const { id } = await t.submitted();
    const answers = await Promise.all([
      t.sendApplicant(id, REPLY),
      t.sendStaff(id, MESSAGE),
      t.sendStaff(id, MESSAGE, t.ada),
      t.sendApplicant(id, REPLY),
    ]);

    expect(answers.map((response) => response.statusCode)).toEqual([201, 201, 201, 201]);
    expect(await threadsOf(id)).toHaveLength(1);
    expect(await messagesOf(id)).toHaveLength(4);
  });

  it('changes no application, stage or decision', async () => {
    const { id } = await t.submitted();
    const state = () =>
      t.rows(
        `SELECT a.status, a.stage_id, a.updated_by,
                (SELECT count(*) FROM grants.decision d WHERE d.application_id = a.id) AS decisions
           FROM grants.application a WHERE a.id = $1`,
        [id],
      );
    const before = await state();

    await t.staffSent(id);
    await t.applicantSent(id);

    expect(await state()).toEqual(before);
  });
});

describe('reading and marking read', () => {
  it('counts unread for the caller’s side only, and marking read changes only that side', async () => {
    const { id } = await t.submitted();
    await t.applicantSent(id);
    await t.staffSent(id);
    await t.staffSent(id, `${MESSAGE} again`);

    expect(await t.staffThread(id)).toMatchObject({ unreadCount: 1 });
    expect(await t.applicantThread(id)).toMatchObject({ unreadCount: 2 });
    expect(await readTimes(id)).toEqual({ applicant_read_at: null, staff_read_at: null });

    const read = await t.send(t.ann, 'POST', t.mine(id, '/read'), undefined, 'portal');
    expect(read.statusCode).toBe(204);
    expect(await t.applicantThread(id)).toMatchObject({ unreadCount: 0 });
    expect(await t.staffThread(id)).toMatchObject({ unreadCount: 1 });
    const afterApplicant = await readTimes(id);
    expect(afterApplicant?.applicant_read_at).toBeInstanceOf(Date);
    expect(afterApplicant?.staff_read_at).toBeNull();

    expect((await t.send(t.managerA, 'POST', t.staffPath(id, '/read'))).statusCode).toBe(204);
    expect(await t.staffThread(id)).toMatchObject({ unreadCount: 0 });
    expect((await readTimes(id))?.applicant_read_at).toEqual(afterApplicant?.applicant_read_at);
  });

  it('answers an empty thread before any message, and marks nothing read', async () => {
    const { id } = await t.submitted();

    expect(await t.applicantThread(id)).toEqual({ messages: [], unreadCount: 0 });
    expect(await t.staffThread(id)).toEqual({ messages: [], unreadCount: 0 });
    expect((await t.send(t.ann, 'POST', t.mine(id, '/read'), undefined, 'portal')).statusCode).toBe(
      204,
    );
    expect(await threadsOf(id)).toEqual([]);
  });

  it('records each staff read of a thread, with or without messages, and never a body', async () => {
    const { id } = await t.submitted();
    await t.staffThread(id);
    await t.staffSent(id);
    await t.staffThread(id);
    await t.applicantThread(id);

    const events = await t.eventsOf<{
      actor_id: string;
      subject_party_id: string;
      changes: object;
    }>('grants.application.messages_viewed', id);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({
        actor_id: t.managerA.membershipId,
        subject_party_id: await personOf(id),
      });
      expect(JSON.stringify(event)).not.toContain('Synthetic');
    }
  });
});

describe('who may use the message routes', () => {
  it('refuses members without the permission, the wrong app and signed-out callers', async () => {
    const { id } = await t.submitted();
    const staff = [
      ['GET', t.staffPath(id), undefined],
      ['POST', t.staffPath(id), { body: MESSAGE }],
      ['POST', t.staffPath(id, '/read'), undefined],
    ] as const;
    const portal = [
      ['GET', t.mine(id), undefined],
      ['POST', t.mine(id), { body: REPLY }],
      ['POST', t.mine(id, '/read'), undefined],
    ] as const;

    for (const [method, url, body] of staff) {
      for (const member of [t.grace, t.adminA]) {
        expect((await t.send(member, method, url, body)).statusCode, url).toBe(403);
      }
      expect((await t.send(t.ann, method, url, body, 'console')).statusCode, url).not.toBe(200);
      expect((await t.send(undefined, method, url, body)).statusCode, url).toBe(401);
    }
    for (const [method, url, body] of portal) {
      expect((await t.send(t.managerA, method, url, body, 'portal')).statusCode, url).toBe(403);
      expect((await t.send(undefined, method, url, body)).statusCode, url).toBe(401);
    }
    expect(await threadsOf(id)).toEqual([]);
  });

  it('answers another applicant, another tenant, a draft and a missing id as one missing record', async () => {
    const { id } = await t.submitted();
    await t.applicantSent(id);
    const draft = await t.aDraft(t.ann, (await t.reviewRound()).open.round.id);

    for (const [method, tail, body] of [
      ['GET', '', undefined],
      ['POST', '', { body: REPLY }],
      ['POST', '/read', undefined],
    ] as const) {
      const missing = await t.send(t.ann, method, t.mine(randomUUID(), tail), body, 'portal');
      for (const other of [t.ben, t.cat]) {
        expectLooksMissing(await t.send(other, method, t.mine(id, tail), body, 'portal'), missing);
      }
      expectLooksMissing(
        await t.send(t.ann, method, t.mine(draft.id, tail), body, 'portal'),
        missing,
      );

      const missingStaff = await t.send(t.managerA, method, t.staffPath(randomUUID(), tail), body);
      expectLooksMissing(
        await t.send(t.managerB, method, t.staffPath(id, tail), body),
        missingStaff,
      );
      expectLooksMissing(
        await t.send(t.managerA, method, t.staffPath(draft.id, tail), body),
        missingStaff,
      );
    }
    expect(await messagesOf(id)).toHaveLength(1);
    expect(await messagesOf(draft.id)).toEqual([]);
  });

  it('answers 404 on every route while grants is switched off for the tenant', async () => {
    const { id } = await t.submitted();
    await switchModule(t.tenantA, 'grants', false);
    try {
      const responses = await Promise.all([
        t.send(t.ann, 'GET', t.mine(id), undefined, 'portal'),
        t.sendApplicant(id, REPLY),
        t.send(t.ann, 'POST', t.mine(id, '/read'), undefined, 'portal'),
        t.send(t.managerA, 'GET', t.staffPath(id)),
        t.sendStaff(id, MESSAGE),
        t.send(t.managerA, 'POST', t.staffPath(id, '/read')),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        404, 404, 404, 404, 404, 404,
      ]);
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
    expect(await messagesOf(id)).toEqual([]);
  });

  it('gives a reviewer, assigned or not, no message in any response', async () => {
    const { round, submissionId } = await t.assigned(t.grace);
    await t.applicantSent(submissionId);
    await t.staffSent(submissionId);
    const assignment = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) ?? '';

    const bodies = (
      await Promise.all([
        ...t
          .reviewerRoutes(assignment, round.need.id)
          .filter(([method]) => method === 'GET')
          .map(([method, url]) => t.send(t.grace, method, url)),
        t.send(t.grace, 'GET', t.staffPath(submissionId)),
        t.send(t.alan, 'GET', t.staffPath(submissionId)),
      ])
    ).map((response) => response.body);

    for (const body of bodies) expect(body).not.toMatch(/Synthetic|funder message|applicant reply/);
    expect(
      (await t.send(t.grace, 'GET', t.staffPath(submissionId))).json<Problem>().detail,
    ).not.toContain('Synthetic');
  });
});
