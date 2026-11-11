// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff notes through the whole API against the test database, as app_api, for
// two tenants: who may write and read them, whom a note may mention, what the
// tables and the audit log hold (never a body), that a failed write leaves
// nothing, and that no applicant or reviewer route returns a note.

import { randomUUID } from 'node:crypto';

import { notesMessages, type NoteView } from '@pixel-scientists/domain/notes';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import { composeModules } from '../src/modules.ts';
import { switchModule } from './modules-on.ts';
import { NOTE, startMessagesApi, type MessagesApi } from './messages-api.ts';
import { answer, type Problem } from './programme-api.ts';
import { addMember } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: MessagesApi;

beforeAll(async () => {
  t = await startMessagesApi('41120');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const addNote = (id: string, body: object, member = t.managerA, key?: string) =>
  t.send(member, 'POST', t.notesPath(id), body, 'console', null, key);

const notesOf = (id: string) =>
  t.rows<{ id: string; author_id: string; body: string }>(
    `SELECT n.id, n.author_id, n.body FROM app.note n
       JOIN grants.application_note l ON l.note_id = n.id WHERE l.application_id = $1`,
    [id],
  );

const mentionsOf = (noteId: string) =>
  t.rows<{ membership_id: string }>(
    'SELECT membership_id FROM app.note_mention WHERE note_id = $1 ORDER BY membership_id',
    [noteId],
  );

const applicantOf = async (id: string) =>
  (
    await t.rows<{ applicant_person_id: string }>(
      'SELECT applicant_person_id FROM grants.application WHERE id = $1',
      [id],
    )
  )[0]?.applicant_person_id;

describe('adding a note', () => {
  it('writes it as the session’s member with its mentions and link, and audits ids only', async () => {
    const { id } = await t.submitted();
    const note = await answer<NoteView>(
      addNote(id, { body: NOTE, mentions: [t.ada.membershipId] }),
      201,
    );

    expect(note).toMatchObject({
      body: NOTE,
      author: { membershipId: t.managerA.membershipId },
      mentions: [{ membershipId: t.ada.membershipId, name: 'Ada Lovelace' }],
    });
    expect(await notesOf(id)).toEqual([
      { id: note.id, author_id: t.managerA.membershipId, body: NOTE },
    ]);
    expect(await mentionsOf(note.id)).toEqual([{ membership_id: t.ada.membershipId }]);

    const [event] = await t.eventsOf<{
      actor_id: string;
      subject_party_id: string;
      changes: object;
    }>('grants.application.note_added', id);
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      subject_party_id: await applicantOf(id),
    });
    expect(JSON.stringify(event?.changes)).toContain(note.id);
    expect(JSON.stringify(event?.changes)).not.toMatch(/Synthetic|Ada|Lovelace/);
  });

  it('lists the notes of an application newest first, for staff', async () => {
    const { id } = await t.submitted();
    const first = await answer<NoteView>(addNote(id, { body: `${NOTE} one` }), 201);
    const second = await answer<NoteView>(addNote(id, { body: `${NOTE} two` }, t.ada), 201);
    const listed = await answer<{ notes: NoteView[] }>(t.send(t.managerA, 'GET', t.notesPath(id)));

    expect(listed.notes.map((note) => note.id)).toEqual([second.id, first.id]);
    expect(listed.notes[0]?.author.membershipId).toBe(t.ada.membershipId);
  });

  it('is idempotent: the same key makes one note and one set of mentions', async () => {
    const { id } = await t.submitted();
    const key = randomUUID();
    const body = { body: NOTE, mentions: [t.ada.membershipId] };
    const first = await answer<NoteView>(addNote(id, body, t.managerA, key), 201);
    const again = await answer<NoteView>(addNote(id, body, t.managerA, key), 201);

    expect(again.id).toBe(first.id);
    expect(await notesOf(id)).toHaveLength(1);
    expect(await mentionsOf(first.id)).toHaveLength(1);
  });

  it('refuses a body naming an author, tenant or application, or a mention written as text', async () => {
    const { id } = await t.submitted();
    const refusals = await Promise.all([
      addNote(id, { body: NOTE, authorId: t.ada.membershipId }),
      addNote(id, { body: NOTE, tenantId: t.tenantB.id }),
      addNote(id, { body: NOTE, applicationId: randomUUID() }),
      addNote(id, { body: NOTE, mentions: ['@Ada'] }),
      addNote(id, { body: '  ' }),
    ]);

    expect(refusals.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
    expect(await notesOf(id)).toEqual([]);
  });

  it('refuses a mention of anyone who may not see applications, naming no one', async () => {
    const { id } = await t.submitted();
    const suspended = await addMember(t.tenantA, 'console', 'programme_manager');
    const removed = await addMember(t.tenantA, 'console', 'programme_manager');
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [
        suspended.membershipId,
      ]);
      await client.query("UPDATE app.membership SET status = 'removed' WHERE id = $1", [
        removed.membershipId,
      ]);
    });
    const outside = [
      t.grace.membershipId,
      t.adminA.membershipId,
      suspended.membershipId,
      removed.membershipId,
      t.managerB.membershipId,
      randomUUID(),
    ];

    for (const membershipId of outside) {
      const response = await addNote(id, {
        body: NOTE,
        mentions: [t.ada.membershipId, membershipId],
      });
      expect(response.statusCode, membershipId).toBe(400);
      const problem = response.json<Problem>();
      expect(problem.errors).toEqual([
        { field: 'body.mentions.1', message: notesMessages.mentionNotAllowed },
      ]);
      expect(response.body).not.toMatch(new RegExp(`${membershipId}|Grace|Hopper|Ada`));
    }
    const twice = await addNote(id, {
      body: NOTE,
      mentions: [t.ada.membershipId, t.ada.membershipId],
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json<Problem>().errors?.[0]?.message).toBe(notesMessages.mentionOnce);
    expect(await notesOf(id)).toEqual([]);
  });

  it('lists as mentionable only the active members who may read applications, by name', async () => {
    const { id } = await t.submitted();
    const { members } = await answer<{ members: { membershipId: string; name: string | null }[] }>(
      t.send(t.managerA, 'GET', `/console/submissions/${id}/mentionable-members`),
    );
    const ids = members.map((member) => member.membershipId);

    expect(ids).toContain(t.managerA.membershipId);
    expect(members.find((member) => member.membershipId === t.ada.membershipId)?.name).toBe(
      'Ada Lovelace',
    );
    for (const outside of [t.grace, t.adminA, t.managerB, t.ann]) {
      expect(ids).not.toContain(outside.membershipId);
    }
  });

  it('leaves no note, mention, link or event when the write fails after the note is made', async () => {
    const dan = await addMember(t.tenantA, 'portal', 'applicant');
    const { id } = await t.submitted(dan);
    const person = await applicantOf(id);
    // An erased applicant takes nothing new (migration 0052): the link is refused after the note is written.
    await asMigratorIn(t.tenantA.id, async (client) => {
      await client.query(
        `UPDATE party.person SET given_name = NULL, family_name = NULL, phone = NULL,
                user_id = NULL, email = id::text || '@erased.invalid' WHERE id = $1`,
        [person],
      );
      await client.query("UPDATE party.party SET status = 'erased' WHERE id = $1", [person]);
    });
    const before = await t.rows('SELECT count(*) AS n FROM app.note');

    const response = await addNote(id, { body: NOTE, mentions: [t.ada.membershipId] });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(NOTE);
    expect(await t.rows('SELECT count(*) AS n FROM app.note')).toEqual(before);
    expect(await notesOf(id)).toEqual([]);
    expect(await t.eventsOf('grants.application.note_added', id)).toEqual([]);
  });
});

describe('who may use the note routes', () => {
  it('refuses members without the permission, applicants and signed-out callers', async () => {
    const { id } = await t.submitted();
    const routes = [
      ['GET', t.notesPath(id)],
      ['POST', t.notesPath(id)],
      ['GET', `/console/submissions/${id}/mentionable-members`],
    ] as const;

    for (const [method, url] of routes) {
      const body = method === 'POST' ? { body: NOTE } : undefined;
      for (const member of [t.grace, t.adminA]) {
        expect(
          (await t.send(member, method, url, body)).statusCode,
          `${member.userId} ${url}`,
        ).toBe(403);
      }
      expect((await t.send(t.ann, method, url, body, 'console')).statusCode).not.toBe(200);
      expect((await t.send(undefined, method, url, body)).statusCode).toBe(401);
    }
    expect(await notesOf(id)).toEqual([]);
  });

  it('answers another tenant’s caller, a draft and a missing id as one missing record', async () => {
    const { id } = await t.submitted();
    const draft = await t.aDraft(t.ann, (await t.reviewRound()).open.round.id);
    await answer(addNote(id, { body: NOTE }), 201);

    for (const [method, tail] of [
      ['GET', ''],
      ['POST', ''],
      ['GET', '-members'],
    ] as const) {
      const url = (target: string) =>
        tail === '-members'
          ? `/console/submissions/${target}/mentionable-members`
          : t.notesPath(target);
      const body =
        method === 'POST' ? { body: NOTE, mentions: [t.managerB.membershipId] } : undefined;
      const missing = await t.send(t.managerA, method, url(randomUUID()), body);
      expectLooksMissing(await t.send(t.managerB, method, url(id), body), missing);
      expectLooksMissing(await t.send(t.managerA, method, url(draft.id), body), missing);
    }
    expect(await notesOf(id)).toHaveLength(1);
  });

  it('answers 404 on every route while grants is switched off for the tenant', async () => {
    const { id } = await t.submitted();
    await switchModule(t.tenantA, 'grants', false);
    try {
      for (const [method, url] of [
        ['GET', t.notesPath(id)],
        ['POST', t.notesPath(id)],
        ['GET', `/console/submissions/${id}/mentionable-members`],
      ] as const) {
        const response = await t.send(
          t.managerA,
          method,
          url,
          method === 'POST' ? { body: NOTE } : undefined,
        );
        expect(response.statusCode, url).toBe(404);
      }
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
    expect(await notesOf(id)).toEqual([]);
  });
});

describe('where notes are never returned', () => {
  it('registers note routes for staff who read applications, in the whole tenant, and no other', () => {
    const { routes } = composeModules({
      publicTenants: {
        tenant: () => Promise.resolve(undefined),
        logo: () => Promise.resolve(undefined),
      },
    });
    const noteRoutes = routes.filter(({ contract }) =>
      /\/(notes|mentionable-members)/.test(contract.path),
    );

    expect(noteRoutes).toHaveLength(3);
    for (const { contract } of noteRoutes) {
      expect(contract).toMatchObject({
        audience: 'console',
        permission: 'grants.applications.read',
        scope: 'tenant',
      });
    }
  });

  it('keeps note text, authors and mentions out of every applicant and reviewer response', async () => {
    const { round, submissionId } = await t.assigned(t.grace);
    const note = await answer<NoteView>(
      addNote(submissionId, { body: NOTE, mentions: [t.ada.membershipId] }),
      201,
    );
    const assignment = (await t.assignmentsOf(submissionId)).get(t.grace.membershipId) ?? '';
    const secrets = [NOTE, note.id, t.managerA.membershipId, t.ada.membershipId, 'Lovelace'];

    const responses = [
      ...t
        .everyRoute(round.open.round.id, submissionId)
        .filter(([method]) => method === 'GET')
        .map(([method, url]) => t.send(t.ann, method, url, undefined, 'portal')),
      ...t
        .reviewerRoutes(assignment, round.need.id)
        .filter(([method]) => method === 'GET')
        .map(([method, url]) => t.send(t.grace, method, url)),
      t.send(t.managerA, 'GET', `/console/submissions/${submissionId}`),
    ];
    const bodies = (await Promise.all(responses)).map((response) => response.body);

    expect(bodies.length).toBeGreaterThan(3);
    for (const body of bodies) for (const secret of secrets) expect(body).not.toContain(secret);
  });
});
