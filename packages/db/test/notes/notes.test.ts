// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.note, app.note_mention and grants.application_note (migration 0052):
// denied across tenants, the body and mention checks, one application per
// note, append-only for every app role, and the database's own times.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication } from '../grants/application-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addNote, expectEveryRoleRefused, insertOutcome, noteRow } from './fixtures.ts';

let tenant: TestTenant;
let member: string;
let note: string;
let application: string;
let strangers: { member: string; note: string; application: string };

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  ({ member, note } = await asMigratorIn(tenant.id, (client) => addNote(client, tenant)));
  application = await asMigratorIn(tenant.id, async (client) => {
    const { id } = await addApplication(client, tenant);
    return id;
  });
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const added = await addNote(client, stranger);
    const { id } = await addApplication(client, stranger);
    return { member: added.member, note: added.note, application: id };
  });
}, 60_000);

const mentionRow = (change = {}) => ({
  tenant_id: tenant.id,
  note_id: note,
  membership_id: member,
  ...change,
});
const joinRow = (change = {}) => ({
  tenant_id: tenant.id,
  note_id: note,
  application_id: application,
  ...change,
});

describe('app.note', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.note', async (client, row) =>
      noteRow(row, await addMember(client, row)),
    ));

  it.each([
    ['blank', '   '],
    ['untrimmed', ' Synthetic'],
    ['over the limit', 'x'.repeat(5001)],
    ['only zero-width', '\u200b'],
  ])('refuses a body that is %s', async (_name, body) => {
    expect(
      await insertOutcome('app_api', tenant, 'app.note', noteRow(tenant, member, { body })),
    ).toBe('23514');
  });

  it('allows a body at the limit', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.note',
        noteRow(tenant, member, { body: 'x'.repeat(5000) }),
      ),
    ).toBe('ok');
  });

  it("refuses another tenant's member as author", async () => {
    expect(
      await insertOutcome('app_api', tenant, 'app.note', noteRow(tenant, strangers.member)),
    ).toBe('23503');
  });

  it('sets its own creation time, and refuses one from the caller', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.note', noteRow(tenant, member, { created_at: new Date(0) })),
    );
    await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<{ created_at: Date }>(
        'SELECT created_at FROM app.note WHERE id = $1',
        [id],
      );
      expect(rows[0]?.created_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.note',
        noteRow(tenant, member, { created_at: new Date(0) }),
      ),
    ).toBe('42501');
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      "UPDATE app.note SET body = 'x' WHERE id = $1",
      'DELETE FROM app.note WHERE id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [note]);
    }
  });

  it('cannot be read by app_worker', async () => {
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, 'SELECT id FROM app.note')).toBe('42501');
    });
  });
});

describe('app.note_mention', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.note_mention', async (client, row) => {
      const added = await addNote(client, row);
      return { tenant_id: row.id, note_id: added.note, membership_id: added.member };
    }));

  it("refuses another tenant's note or member", async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.note_mention',
        mentionRow({ note_id: strangers.note }),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'app.note_mention',
        mentionRow({ membership_id: strangers.member }),
      ),
    ).toBe('23503');
  });

  it('holds at most ten mentions per note, each once', async () => {
    const capped = await asMigratorIn(tenant.id, async (client) => {
      const { note: id } = await addNote(client, tenant);
      for (let index = 0; index < 10; index += 1) {
        await insertRow(client, 'app.note_mention', {
          tenant_id: tenant.id,
          note_id: id,
          membership_id: await addMember(client, tenant),
        });
      }
      return { id, extra: await addMember(client, tenant) };
    });
    expect(
      await insertOutcome('app_api', tenant, 'app.note_mention', {
        tenant_id: tenant.id,
        note_id: capped.id,
        membership_id: capped.extra,
      }),
    ).toBe('23514');
    expect(await insertOutcome('app_api', tenant, 'app.note_mention', mentionRow())).toBe('ok');
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'app.note_mention', mentionRow());
      const duplicate = await outcome(
        client,
        'INSERT INTO app.note_mention (tenant_id, note_id, membership_id) VALUES ($1, $2, $3)',
        [tenant.id, note, member],
      );
      expect(duplicate).toBe('23505');
    });
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      'UPDATE app.note_mention SET membership_id = membership_id WHERE note_id = $1',
      'DELETE FROM app.note_mention WHERE note_id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [note]);
    }
  });
});

describe('grants.application_note', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('grants.application_note', async (client, row) => {
      const added = await addNote(client, row);
      const { id } = await addApplication(client, row);
      return { tenant_id: row.id, note_id: added.note, application_id: id };
    }));

  it("refuses another tenant's note or application, and a second application", async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'grants.application_note',
        joinRow({ note_id: strangers.note }),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'grants.application_note',
        joinRow({ application_id: strangers.application }),
      ),
    ).toBe('23503');
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.application_note', joinRow());
      expect(
        await outcome(
          client,
          'INSERT INTO grants.application_note (tenant_id, note_id, application_id) VALUES ($1, $2, $3)',
          [tenant.id, note, application],
        ),
      ).toBe('23505');
    });
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      'UPDATE grants.application_note SET application_id = application_id WHERE note_id = $1',
      'DELETE FROM grants.application_note WHERE note_id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [note]);
    }
  });
});
