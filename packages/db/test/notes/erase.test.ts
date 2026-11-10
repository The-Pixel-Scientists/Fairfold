// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.erase_subject_notes (migration 0052, ADR 0027): only app_worker runs
// it, only for a party already erased in the transaction's tenant; it clears
// bodies and the notification recipient, keeps ids and times, deletes nothing
// and, called again after a restore, clears the restored rows. Once a party is
// erased, the guards refuse new text on their application and any write that
// names them or puts a cleared value back, whoever asks.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addParts, applicationRow } from '../grants/application-fixtures.ts';
import { addReleased } from '../grants/decision-fixtures.ts';
import { addErasureRequest, callAs, erase } from '../erasure/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  applicantMessage,
  insertOutcome,
  MESSAGE_TEXT,
  NOTE_TEXT,
  noteRow,
  staffMessage,
} from './fixtures.ts';

const ERASE_NOTES = 'SELECT app.erase_subject_notes($1) AS counts';

let tenant: TestTenant;
let staff: string;
let person: string;
let application: string;
let live: string;
let note: string;
let keptNote: string;
let staffNote: string;
let message: string;
let applicantOwn: string;
let keptMessage: string;
let notification: string;
let template: string;
let thread: string;

async function bodies(table: string, ids: readonly string[]): Promise<Record<string, string>> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string; body: string }>(
      `SELECT id, body FROM ${table} WHERE id = ANY ($1::uuid[])`,
      [ids],
    );
    return Object.fromEntries(rows.map(({ id, body }) => [id, body]));
  });
}

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    staff = await addMember(client, tenant, ['programme_manager']);
    const released = await addReleased(client, tenant);
    template = released.template;
    const parts = released.parts;
    person = parts.person;
    application = released.application;

    const liveParts = await addParts(client, tenant);
    live = liveParts.person;
    const keptApplication = await insertRow(
      client,
      'grants.application',
      applicationRow(tenant, liveParts),
    );

    note = await insertRow(client, 'app.note', noteRow(tenant, staff));
    staffNote = await insertRow(client, 'app.note', noteRow(tenant, staff));
    keptNote = await insertRow(client, 'app.note', noteRow(tenant, staff));
    await insertRow(client, 'app.note_mention', {
      tenant_id: tenant.id,
      note_id: note,
      membership_id: staff,
    });
    for (const [noteId, applicationId] of [
      [note, application],
      [staffNote, application],
      [keptNote, keptApplication],
    ]) {
      await insertRow(client, 'grants.application_note', {
        tenant_id: tenant.id,
        note_id: noteId,
        application_id: applicationId,
      });
    }

    thread = await insertRow(client, 'app.message_thread', { tenant_id: tenant.id });
    const keptThread = await insertRow(client, 'app.message_thread', { tenant_id: tenant.id });
    for (const [appId, threadId] of [
      [application, thread],
      [keptApplication, keptThread],
    ]) {
      await insertRow(client, 'grants.application_message', {
        tenant_id: tenant.id,
        application_id: appId,
        thread_id: threadId,
      });
    }
    message = await insertRow(client, 'app.message', staffMessage(tenant, thread, staff));
    applicantOwn = await insertRow(client, 'app.message', applicantMessage(tenant, thread, person));
    keptMessage = await insertRow(client, 'app.message', staffMessage(tenant, keptThread, staff));

    notification = await insertRow(client, 'grants.message_notification', {
      tenant_id: tenant.id,
      message_id: message,
      recipient_person_id: person,
      template_version_id: released.template,
    });
  });
}, 60_000);

const clearNotes = (party: string, inTenant: TestTenant | null = tenant) =>
  callAs('app_worker', inTenant ?? undefined, ERASE_NOTES, [party]);

/** The guards a restored database's rows never went through, switched in the restore's transaction. */
async function switchGuards(client: pg.ClientBase, state: 'DISABLE' | 'ENABLE') {
  await client.query(`ALTER TABLE app.note ${state} TRIGGER refuse_erased_applicant_note`);
  await client.query(`ALTER TABLE app.message ${state} TRIGGER refuse_erased_applicant_message`);
  await client.query(
    `ALTER TABLE grants.message_notification ${state} TRIGGER refuse_erased_party`,
  );
}

async function restorePreErasure() {
  await asMigratorIn(tenant.id, async (client) => {
    await switchGuards(client, 'DISABLE');
    await client.query('UPDATE app.note SET body = $1 WHERE id = ANY ($2::uuid[])', [
      NOTE_TEXT,
      [note, staffNote],
    ]);
    await client.query('UPDATE app.message SET body = $1 WHERE id = ANY ($2::uuid[])', [
      MESSAGE_TEXT,
      [message, applicantOwn],
    ]);
    await client.query(
      `UPDATE grants.message_notification
          SET recipient_person_id = $1, status = 'queued', error_code = NULL WHERE id = $2`,
      [person, notification],
    );
    await switchGuards(client, 'ENABLE');
  });
}

describe('app.erase_subject_notes', { timeout: 60_000 }, () => {
  it('runs only for app_worker, only for an erased party of the tenant', async () => {
    expect((await callAs('app_api', tenant, ERASE_NOTES, [person])).code).toBe('42501');
    expect((await clearNotes(person)).code).toBe('55000');
    expect((await clearNotes(person, null)).code).toBe('55000');
    expect(await bodies('app.note', [note])).toEqual({ [note]: NOTE_TEXT });
  });

  it('clears bodies and the recipient, keeps everything else, and counts', async () => {
    const request = await asMigratorIn(tenant.id, (client) =>
      addErasureRequest(client, tenant, staff, person),
    );
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    const stranger = await createTestTenant();
    expect((await clearNotes(person, stranger)).code).toBe('55000');

    const { row, code } = await clearNotes(person);
    expect(code).toBeUndefined();
    expect(row?.['counts']).toEqual({
      'app.note': 2,
      'app.message': 2,
      'grants.message_notification': 1,
    });
    expect(await bodies('app.note', [note, staffNote, keptNote])).toEqual({
      [note]: 'erased',
      [staffNote]: 'erased',
      [keptNote]: NOTE_TEXT,
    });
    expect(await bodies('app.message', [message, applicantOwn, keptMessage])).toEqual({
      [message]: 'erased',
      [applicantOwn]: 'erased',
      [keptMessage]: MESSAGE_TEXT,
    });
    await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT recipient_person_id, status, error_code, template_version_id
           FROM grants.message_notification WHERE id = $1`,
        [notification],
      );
      expect(rows[0]).toEqual({
        recipient_person_id: null,
        status: 'failed',
        error_code: 'no_address',
        template_version_id: template,
      });
      const kept = await client.query<Row>(
        'SELECT author_person_id, side FROM app.message WHERE id = $1',
        [applicantOwn],
      );
      expect(kept.rows[0]).toEqual({ author_person_id: person, side: 'applicant' });
    });
    expect((await clearNotes(person)).row?.['counts']).toEqual({
      'app.note': 0,
      'app.message': 0,
      'grants.message_notification': 0,
    });
  });

  it('refuses new rows naming an erased party', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.message',
        applicantMessage(tenant, thread, person),
      ),
    ).toBe('55000');
    expect(
      await insertOutcome('app_api', tenant, 'grants.message_notification', {
        tenant_id: tenant.id,
        message_id: message,
        recipient_person_id: person,
        template_version_id: template,
      }),
    ).toBe('55000');
  });

  it('attaches nothing new to an erased applicant, in any order or from either side', async () => {
    const [looseNote, looseThread] = await asMigratorIn(tenant.id, async (client) => [
      await insertRow(client, 'app.note', noteRow(tenant, staff)),
      await insertRow(client, 'app.message_thread', { tenant_id: tenant.id }),
    ]);
    expect(
      await insertOutcome('app_api', tenant, 'grants.application_note', {
        tenant_id: tenant.id,
        note_id: looseNote,
        application_id: application,
      }),
    ).toBe('55000');
    expect(
      await insertOutcome('app_api', tenant, 'app.message', staffMessage(tenant, thread, staff)),
    ).toBe('55000');
    expect(
      await insertOutcome('app_api', tenant, 'grants.application_message', {
        tenant_id: tenant.id,
        application_id: application,
        thread_id: looseThread,
      }),
    ).toBe('55000');
  });

  it('refuses, even for migrator, a write that names an erased party or restores a body', async () => {
    const refused = (statement: string, values: readonly unknown[]) =>
      asMigratorIn(tenant.id, (client) => outcome(client, statement, values));
    const SET_BODY = 'SET body = $1 WHERE id = $2';
    expect(await refused(`UPDATE app.note ${SET_BODY}`, [NOTE_TEXT, note])).toBe('55000');
    expect(await refused(`UPDATE app.message ${SET_BODY}`, [MESSAGE_TEXT, message])).toBe('55000');
    const SET_AUTHOR = 'UPDATE app.message SET author_person_id = $1 WHERE id = $2';
    expect(await refused(SET_AUTHOR, [person, keptMessage])).toBe('55000');
    expect(await refused(SET_AUTHOR, [live, applicantOwn])).toBe('55000');
    expect(
      await refused(
        'UPDATE grants.message_notification SET recipient_person_id = $1 WHERE id = $2',
        [person, notification],
      ),
    ).toBe('55000');
    expect(await bodies('app.note', [note])).toEqual({ [note]: 'erased' });
    expect(await bodies('app.message', [message])).toEqual({ [message]: 'erased' });
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await restorePreErasure();
    expect((await clearNotes(person)).row?.['counts']).toEqual({
      'app.note': 2,
      'app.message': 2,
      'grants.message_notification': 1,
    });
    expect(await bodies('app.note', [note, staffNote])).toEqual({
      [note]: 'erased',
      [staffNote]: 'erased',
    });
    expect(await bodies('app.message', [message, applicantOwn])).toEqual({
      [message]: 'erased',
      [applicantOwn]: 'erased',
    });
  });

  it('leaves a live party alone', async () => {
    expect((await clearNotes(live)).code).toBe('55000');
  });
});
