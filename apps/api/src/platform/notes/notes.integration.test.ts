// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The note and message service against the test database, as app_api, for two
// tenants: who may be mentioned, what a note and a thread hold, that marking
// read changes one side only, and that nothing reaches across tenants.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { smtpTestSettings, tenantId } from '../../../test/support.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { notesPlatform as notes } from './index.ts';

let database: ApiDatabase;
let tenantA: TestTenant;
let tenantB: TestTenant;
let manager: string;
let reviewer: string;
let suspended: string;
let managerB: string;

const inA = <T>(work: Parameters<ApiDatabase['inTenant']>[1]) =>
  database.inTenant(tenantId(tenantA.id), work) as Promise<T>;
const inB = <T>(work: Parameters<ApiDatabase['inTenant']>[1]) =>
  database.inTenant(tenantId(tenantB.id), work) as Promise<T>;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41045',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  const userId = await createTestUser();
  manager = await asMigratorIn(tenantA.id, async (client) => {
    await addPerson(client, tenantA, {
      user_id: userId,
      given_name: 'Ada',
      family_name: 'Lovelace',
    });
    return insertRow(client, 'app.membership', {
      tenant_id: tenantA.id,
      user_id: userId,
      roles: ['programme_manager'],
    });
  });
  reviewer = await asMigratorIn(tenantA.id, (client) => addMember(client, tenantA, ['reviewer']));
  suspended = await asMigratorIn(tenantA.id, async (client) => {
    const id = await addMember(client, tenantA, ['programme_manager']);
    await client.query("UPDATE app.membership SET status = 'suspended' WHERE id = $1", [id]);
    return id;
  });
  managerB = await asMigratorIn(tenantB.id, (client) =>
    addMember(client, tenantB, ['programme_manager']),
  );
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('mentionable', () => {
  it('lists the active members who hold the permission, by name, in this tenant only', async () => {
    const members = await inA<{ membershipId: string; name: string | null }[]>((tx) =>
      notes.mentionable(tx, 'grants.applications.read'),
    );

    expect(members).toContainEqual({ membershipId: manager, name: 'Ada Lovelace' });
    const ids = members.map((member) => member.membershipId);
    for (const outside of [reviewer, suspended, managerB]) expect(ids).not.toContain(outside);
    const inOther = await inB<{ membershipId: string }[]>((tx) =>
      notes.mentionable(tx, 'grants.applications.read'),
    );
    expect(inOther.map((member) => member.membershipId)).toEqual([managerB]);
  });
});

describe('notes', () => {
  it('writes a note with its mentions and reads it back newest first, with names', async () => {
    const { first, second } = await inA<{ first: string; second: string }>(async (tx) => ({
      first: await notes.addNote(tx, { authorId: manager, body: 'One', mentions: [] }),
      second: await notes.addNote(tx, { authorId: manager, body: 'Two', mentions: [manager] }),
    }));

    const read = await inA<Awaited<ReturnType<typeof notes.readNotes>>>((tx) =>
      notes.readNotes(tx, [first, second]),
    );

    expect(read.map((note) => note.id).sort()).toEqual([first, second].sort());
    const withMention = read.find((note) => note.id === second);
    expect(withMention).toMatchObject({
      body: 'Two',
      author: { membershipId: manager, name: 'Ada Lovelace' },
      mentions: [{ membershipId: manager, name: 'Ada Lovelace' }],
    });
    expect(read.find((note) => note.id === first)?.mentions).toEqual([]);
  });

  it('shows another tenant nothing, and refuses an author or mention from another tenant', async () => {
    const note = await inA<string>((tx) =>
      notes.addNote(tx, { authorId: manager, body: 'Private', mentions: [] }),
    );

    expect(await inB((tx) => notes.readNotes(tx, [note]))).toEqual([]);
    await expect(
      inB((tx) => notes.addNote(tx, { authorId: manager, body: 'Hello', mentions: [] })),
    ).rejects.toThrow();
    await expect(
      inB((tx) => notes.addNote(tx, { authorId: managerB, body: 'Hello', mentions: [manager] })),
    ).rejects.toThrow();
  });
});

describe('threads', () => {
  it('reads messages oldest first, and marking read sets one side’s time only', async () => {
    const thread = await inA<string>((tx) => notes.addThread(tx));
    await inA((tx) =>
      notes.addMessage(tx, { threadId: thread, side: 'staff', body: 'First', authorId: manager }),
    );
    await inA((tx) =>
      notes.addMessage(tx, { threadId: thread, side: 'staff', body: 'Second', authorId: manager }),
    );

    const before = await inA<Awaited<ReturnType<typeof notes.readThread>>>((tx) =>
      notes.readThread(tx, thread),
    );
    expect(before.messages.map((message) => message.body)).toEqual(['First', 'Second']);
    expect(before.messages[0]).toMatchObject({
      side: 'staff',
      authorId: manager,
      authorName: 'Ada Lovelace',
    });
    expect([before.applicantReadAt, before.staffReadAt]).toEqual([null, null]);

    await inA((tx) => notes.markRead(tx, thread, 'applicant'));
    const after = await inA<Awaited<ReturnType<typeof notes.readThread>>>((tx) =>
      notes.readThread(tx, thread),
    );
    expect(after.applicantReadAt).toBeInstanceOf(Date);
    expect(after.staffReadAt).toBeNull();
  });

  it('refuses an applicant message on a thread that no application owns', async () => {
    const thread = await inA<string>((tx) => notes.addThread(tx));
    const person = await asMigratorIn(tenantA.id, (client) => addPerson(client, tenantA));

    await expect(
      inA((tx) =>
        notes.addMessage(tx, {
          threadId: thread,
          side: 'applicant',
          body: 'Hello',
          authorId: person,
        }),
      ),
    ).rejects.toThrow();
  });

  it('shows another tenant nothing of a thread, and takes no message for it', async () => {
    const thread = await inA<string>((tx) => notes.addThread(tx));
    await inA((tx) =>
      notes.addMessage(tx, { threadId: thread, side: 'staff', body: 'Private', authorId: manager }),
    );

    await expect(inB((tx) => notes.readThread(tx, thread))).rejects.toThrow();
    await expect(
      inB((tx) =>
        notes.addMessage(tx, {
          threadId: thread,
          side: 'staff',
          body: 'Hello',
          authorId: managerB,
        }),
      ),
    ).rejects.toThrow();
    await inB((tx) => notes.markRead(tx, thread, 'staff'));
    const read = await inA<Awaited<ReturnType<typeof notes.readThread>>>((tx) =>
      notes.readThread(tx, thread),
    );
    expect(read.staffReadAt).toBeNull();
  });
});
