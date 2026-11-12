// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's erasure contribution against the test database, as
// app_worker (the role the erasure job runs as) in a tenant's transaction:
// the personal and special category answers of an erased applicant's
// applications, cleared by stable field id against each application's pinned
// form version, with everything else kept, nothing of another person, and
// nothing across tenants. It runs the same with the module switched off.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addErasureRequest } from '../../../../packages/db/test/erasure/fixtures.ts';
import {
  addFile,
  addParts,
  applicationRow,
} from '../../../../packages/db/test/grants/application-fixtures.ts';
import {
  addThread,
  applicantMessage,
  MESSAGE_TEXT,
  noteRow,
  NOTE_TEXT,
  staffMessage,
} from '../../../../packages/db/test/notes/fixtures.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { grantsErasure } from './erasure.ts';
import type { Tx } from './programme/tables.ts';

const FORM = {
  sections: [
    {
      id: 's_about',
      title: 'About the applicant',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Project name', classification: 'public' },
        { id: 'f_story', type: 'long_text', label: 'Your story', classification: 'personal' },
        { id: 'f_note', type: 'long_text', label: 'Anything else', classification: 'internal' },
        {
          id: 'f_health',
          type: 'long_text',
          label: 'Any access needs',
          classification: 'special_category',
          audiences: 'aggregate_only',
        },
      ],
    },
  ],
};
const ANSWERS = {
  f_name: 'Hall roof',
  f_story: 'Born in Leeds',
  f_note: 'Second round',
  f_health: 'Step-free access',
  f_removed: 'An answer the pinned version no longer asks',
};

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly bystander: string;
  readonly applications: readonly string[];
  readonly other: string;
  /** The person's linked file, and the bystander's. */
  readonly file: string;
  readonly otherFile: string;
  /** The notes and messages on the person's applications, and a note on the bystander's. */
  readonly notes: readonly string[];
  readonly otherNote: string;
  readonly messages: readonly string[];
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    const form = await insertRow(client, 'grants.form_version', {
      tenant_id: tenant.id,
      round_id: parts.round,
      version: 2,
      status: 'published',
      definition: FORM,
      published_at: new Date(),
      published_by: parts.member,
    });
    const apply = async (person: string, answers: object) =>
      insertRow(
        client,
        'grants.application',
        applicationRow(
          tenant,
          { ...parts, person },
          {
            organisation_id: await addOrganisation(client, tenant),
            form_version_id: form,
            answers: JSON.stringify(answers),
          },
        ),
      );
    const bystander = await addPerson(client, tenant);
    const applications = [
      await apply(parts.person, ANSWERS),
      await apply(parts.person, { f_name: 'Second', f_story: 'Another' }),
    ];
    const other = await apply(bystander, ANSWERS);
    const link = async (application: string) => {
      const file = await addFile(client, tenant, parts.member);
      await insertRow(client, 'grants.application_file', {
        tenant_id: tenant.id,
        application_id: application,
        file_id: file,
        field_id: 'f_accounts',
        created_by: parts.member,
      });
      return file;
    };
    const file = await link(applications[1] ?? '');
    const otherFile = await link(other);
    const noteOn = async (application: string, body: string) => {
      const note = await insertRow(client, 'app.note', noteRow(tenant, parts.member, { body }));
      await insertRow(client, 'grants.application_note', {
        tenant_id: tenant.id,
        note_id: note,
        application_id: application,
      });
      return note;
    };
    const notes = [
      await noteOn(applications[0] ?? '', NOTE_TEXT),
      await noteOn(applications[1] ?? '', NOTE_TEXT),
    ];
    const otherNote = await noteOn(other, NOTE_TEXT);
    const thread = await addThread(client, tenant);
    await insertRow(client, 'grants.application_message', {
      tenant_id: tenant.id,
      application_id: applications[1],
      thread_id: thread,
    });
    const messages = [
      await insertRow(client, 'app.message', staffMessage(tenant, thread, parts.member)),
      await insertRow(client, 'app.message', applicantMessage(tenant, thread, parts.person)),
    ];
    await addErasureRequest(client, tenant, parts.member, parts.person);
    return {
      tenant,
      person: parts.person,
      bystander,
      applications,
      other,
      file,
      otherFile,
      notes,
      otherNote,
      messages,
    };
  });
}

const inTenant = <T>(fixture: Fixture, work: (tx: Tx) => Promise<T>) =>
  withTenant(db, trustedTenantId(fixture.tenant.id), work);

const answersOf = (fixture: Fixture, id: string) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<{ answers: object }>(
      'SELECT answers FROM grants.application WHERE id = $1',
      [id],
    );
    return rows[0]?.answers;
  });

const fileOf = (fixture: Fixture, id: string) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT f.name, f.sha256, f.storage_key, f.erased_at IS NOT NULL AS erased,
              (SELECT count(*) FROM grants.application_file l WHERE l.file_id = f.id)::int AS links
         FROM app.file f WHERE f.id = $1`,
      [id],
    );
    return rows[0];
  });

/** The body of each note and message in the tenant, by id. */
const bodiesOf = (fixture: Fixture) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string; body: string }>(
      'SELECT id, body FROM app.note UNION ALL SELECT id, body FROM app.message',
    );
    return new Map(rows.map((row) => [row.id, row.body]));
  });

const subjectsOf = (fixture: Fixture) => [
  { partyId: fixture.person, givenName: null, familyName: null, email: null, accountId: null },
];

/** What party's contribution does first: the applicant is erased, as the approved function requires. */
const eraseApplicant = (fixture: Fixture) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM app.job_request WHERE kind = 'erasure'",
    );
    return rows[0]?.id;
  }).then((request) =>
    inTenant(fixture, (tx) =>
      tx
        .selectNoFrom((eb) =>
          eb.fn('party.erase_party', [eb.val(fixture.person), eb.val(request ?? '')]).as('counts'),
        )
        .execute(),
    ),
  );

beforeAll(async () => {
  const settings = databaseSettings('app_worker', 4);
  db = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('grantsErasure', () => {
  it('refuses while the applicant is not erased, and changes nothing', async () => {
    await expect(inTenant(a, (tx) => grantsErasure.erase(tx, subjectsOf(a)))).rejects.toThrow();
    expect(await answersOf(a, a.applications[0] ?? '')).toEqual(ANSWERS);
  });

  it('does nothing in tenant B for tenant A’s applicant', async () => {
    expect(await inTenant(b, (tx) => grantsErasure.erase(tx, subjectsOf(a)))).toEqual({
      'grants.application': 0,
      'app.file': 0,
    });
    expect((await fileOf(a, a.file))?.['erased']).toBe(false);
    expect(await answersOf(a, a.applications[0] ?? '')).toEqual(ANSWERS);
    expect(await answersOf(b, b.applications[0] ?? '')).toEqual(ANSWERS);
  });

  it('clears personal, special category and unknown answers by field id, keeps public and internal ones, and counts applications', async () => {
    await eraseApplicant(a);
    const counts = await inTenant(a, (tx) => grantsErasure.erase(tx, subjectsOf(a)));

    expect(counts).toEqual({
      'grants.application': 2,
      'app.file': 1,
      'app.note': 2,
      'app.message': 2,
      'grants.message_notification': 0,
    });
    expect(await answersOf(a, a.applications[0] ?? '')).toEqual({
      f_name: 'Hall roof',
      f_note: 'Second round',
    });
    expect(await answersOf(a, a.applications[1] ?? '')).toEqual({ f_name: 'Second' });
    expect(await answersOf(a, a.other)).toEqual(ANSWERS);
    expect(await answersOf(b, b.applications[0] ?? '')).toEqual(ANSWERS);
  });

  it('erases the files linked to the applications: name, hash and key go, the link stays, a bystander’s file is kept', async () => {
    expect(await fileOf(a, a.file)).toEqual({
      name: 'Erased file',
      sha256: null,
      storage_key: null,
      erased: true,
      links: 1,
    });
    expect(await fileOf(a, a.otherFile)).toMatchObject({
      name: 'Accounts 2025.pdf',
      erased: false,
      links: 1,
    });
    expect(await fileOf(b, b.file)).toMatchObject({ name: 'Accounts 2025.pdf', erased: false });
  });

  it('clears the notes and messages on the applications, keeps their ids, and leaves a bystander’s and tenant B’s', async () => {
    const bodies = await bodiesOf(a);

    for (const id of [...a.notes, ...a.messages]) expect(bodies.get(id), id).toBe('erased');
    expect(bodies.get(a.otherNote)).toBe(NOTE_TEXT);
    const inB = await bodiesOf(b);
    expect([...inB.values()]).not.toContain('erased');
    expect([...inB.values()]).toEqual(expect.arrayContaining([NOTE_TEXT, MESSAGE_TEXT]));
    expect([...bodies.values()].join()).not.toContain(MESSAGE_TEXT);
  });

  it('changes nothing the second time', async () => {
    expect(await inTenant(a, (tx) => grantsErasure.erase(tx, subjectsOf(a)))).toEqual({
      'grants.application': 0,
      'app.file': 0,
      'app.note': 0,
      'app.message': 0,
      'grants.message_notification': 0,
    });
  });
});
