// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Notes and messages on a submitted application, the way people meet them: a
// programme manager adds a note that mentions a colleague, and a mention of
// someone who cannot see the application is refused and changes nothing. The
// manager writes to the applicant, who reads and replies in the portal; the
// email that tells them a message is waiting carries no message text. The
// applicant never reads a staff note, and every note, message and read is in
// the audit log without its text (rule 4).
//
// It reads what the journey left, so it runs after the journey.

import { signInApplicant, signInStaff, type Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { subjectsTo, waitForMessages } from '../support/mail.ts';
import { need, person } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import {
  auditReader,
  call,
  create,
  eventsAbout,
  MESSAGE,
  made,
  membershipIdOf,
  needsJourney,
  NOTE,
  REPLY,
} from './steps.ts';

inOrder();
needsJourney();

const applicationId = () => need('application1Id');
const notesPath = () => `/console/submissions/${applicationId()}/notes`;
const messagesPath = () => `/console/submissions/${applicationId()}/messages`;
const portalMessages = () => `/portal/applications/${applicationId()}/messages`;

interface Note {
  id: string;
  body: string;
  mentions: { membershipId: string }[];
}

let manager: Api;
let applicant: Api;
let reader: Api;

test.describe('notes and messages on a submission', () => {
  test.beforeAll(async () => {
    manager = await signInStaff('northfield', 'manager');
    applicant = await signInApplicant('northfield', 'applicant1');
    reader = await auditReader();
  });

  test.afterAll(async () => {
    await Promise.all([manager.dispose(), applicant.dispose(), reader.dispose()]);
  });

  test('a note mentions a colleague who may see the application, and is audited without its text', async () => {
    const { members } = await manager.ok<{ members: { membershipId: string }[] }>(
      'GET',
      `/console/submissions/${applicationId()}/mentionable-members`,
    );
    const colleague = await membershipIdOf(reader, 'colleague');
    expect(members.map(({ membershipId }) => membershipId)).toContain(colleague);

    const before = await eventsAbout(reader, 'grants.application.note_added', applicationId());
    const note = await made<Note>(
      create(manager, notesPath(), { body: NOTE, mentions: [colleague] }),
    );
    expect(note.mentions.map(({ membershipId }) => membershipId)).toEqual([colleague]);

    const { notes } = await manager.ok<{ notes: Note[] }>('GET', notesPath());
    expect(notes[0]?.id).toBe(note.id);

    const after = await eventsAbout(reader, 'grants.application.note_added', applicationId());
    expect(after).toHaveLength(before.length + 1);
    expect(JSON.stringify(after)).not.toContain('qzx-note');
  });

  test('a mention of a member who cannot see the application is refused and no note is added', async () => {
    const reviewer = await membershipIdOf(reader, 'reviewer1');
    const before = (await manager.ok<{ notes: Note[] }>('GET', notesPath())).notes.length;
    const refused = await create(manager, notesPath(), { body: NOTE, mentions: [reviewer] });
    expect([400, 422]).toContain(refused.status);
    expect(refused.text).not.toContain(reviewer);
    expect((await manager.ok<{ notes: Note[] }>('GET', notesPath())).notes).toHaveLength(before);
  });

  test('the console shows the note, and the page passes axe', async ({ pages }) => {
    const page = await pages.staff('manager');
    await page.goto(`/northfield/submissions/${applicationId()}`);
    await page.getByRole('tab', { name: 'Notes' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Notes' })
        .getByRole('list', { name: 'Notes, newest first' }),
    ).toContainText(NOTE);
    await axePages(page, [`/northfield/submissions/${applicationId()}`]);
  });

  test('the manager writes to the applicant, who is emailed without the message text', async () => {
    const waiting = (await subjectsTo(person('applicant1').email)).length;
    await made(create(manager, messagesPath(), { body: MESSAGE }));

    await expect
      .poll(async () => (await subjectsTo(person('applicant1').email)).length, {
        message: 'The applicant was not told a message is waiting.',
        timeout: 30_000,
      })
      .toBeGreaterThan(waiting);
    const mails = await waitForMessages(person('applicant1').email);
    for (const { text, subject } of mails) {
      expect(text).not.toContain('qzx-message');
      expect(subject).not.toContain('qzx-message');
    }
  });

  test('the applicant reads the message and replies, and the staff read is audited', async () => {
    const thread = await applicant.ok<{ messages: { body: string; side: string }[] }>(
      'GET',
      portalMessages(),
    );
    expect(thread.messages.map(({ body }) => body)).toContain(MESSAGE);
    await made(create(applicant, portalMessages(), { body: REPLY }));

    const before = await eventsAbout(reader, 'grants.application.messages_viewed', applicationId());
    const staff = await manager.ok<{ messages: { body: string }[] }>('GET', messagesPath());
    expect(staff.messages.map(({ body }) => body)).toEqual(
      expect.arrayContaining([MESSAGE, REPLY]),
    );
    const after = await eventsAbout(reader, 'grants.application.messages_viewed', applicationId());
    expect(after).toHaveLength(before.length + 1);

    const sent = await eventsAbout(reader, 'grants.application.message_sent', applicationId());
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify([...after, ...sent])).not.toMatch(/qzx-(message|reply)/);
  });

  test('the applicant never reads a staff note', async () => {
    expect([401, 403, 404]).toContain((await call(applicant, 'GET', notesPath())).status);
    const answers = [
      await applicant.send('GET', `/portal/applications/${applicationId()}`),
      await applicant.send('GET', portalMessages()),
      await applicant.send('GET', '/portal/applications'),
    ];
    for (const { text } of answers) expect(text).not.toContain('qzx-note');
  });
});
