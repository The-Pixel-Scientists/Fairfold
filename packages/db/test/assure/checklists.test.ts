// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.checklist, assure.checklist_version, assure.checklist_response and
// assure.checklist_response_file (migration 0056): denied across tenants;
// names unique among a tenant's live checklists; versions immutable, and a
// checklist moves only to its next published version, with the server's
// app.config_version row beside it (rule 10); answers pinned to their
// version (rule 7), never holding file ids; file answers linked through the
// join, one link per clean file of the tenant (ADR 0030).

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication, addFile } from '../grants/application-fixtures.ts';
import { addProgramme } from '../grants/fixtures.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addChecklist, ITEM_ID, ITEMS, responseRow, versionRow } from './fixtures.ts';

type Added = Awaited<ReturnType<typeof addChecklist>>;

let tenant: TestTenant;
let added: Added;
let application: string;
let response: string;
let programme: string;
let strangers: {
  added: Added;
  application: string;
  file: string;
  response: string;
  programme: string;
};

/** A response to a new checklist on a new application. */
async function addResponse(client: pg.ClientBase, inTenant: TestTenant) {
  const checklist = await addChecklist(client, inTenant);
  const { id } = await addApplication(client, inTenant);
  return {
    checklist,
    application: id,
    response: await insertRow(
      client,
      'assure.checklist_response',
      responseRow(inTenant, id, checklist),
    ),
  };
}

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    ({ checklist: added, application, response } = await addResponse(client, tenant));
    programme = await addProgramme(client, tenant);
  });
  strangers = await asMigratorIn(stranger.id, async (client) => {
    const made = await addResponse(client, stranger);
    return {
      added: made.checklist,
      application: made.application,
      response: made.response,
      file: await addFile(client, stranger, made.checklist.member),
      programme: await addProgramme(client, stranger),
    };
  });
}, 60_000);

describe('assure.checklist', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.checklist', async (client, row) => {
      const member = await addMember(client, row);
      return {
        tenant_id: row.id,
        name: `Checklist ${member}`,
        created_by: member,
        updated_by: member,
      };
    }));

  it('keeps a name unique among live checklists, whatever its case', async () => {
    const name = 'Synthetic unique checklist';
    await asMigratorIn(tenant.id, (client) => addChecklist(client, tenant, name));
    const row = {
      tenant_id: tenant.id,
      name: name.toUpperCase(),
      created_by: added.member,
      updated_by: added.member,
    };
    expect(await insertOutcome('app_api', tenant, 'assure.checklist', row)).toBe('23505');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE assure.checklist SET archived_at = now() WHERE name = $1', [name]),
    );
    expect(await insertOutcome('app_api', tenant, 'assure.checklist', row)).toBe('ok');
  });

  it("refuses another tenant's programme or member", async () => {
    const row = {
      tenant_id: tenant.id,
      name: 'Synthetic stranger checklist',
      created_by: added.member,
      updated_by: added.member,
    };
    const insert = (change: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'assure.checklist', { ...row, ...change });
    expect(await insert({ programme_id: strangers.programme })).toBe('23503');
    expect(await insert({ created_by: strangers.added.member })).toBe('23503');
    expect(await insert({ programme_id: programme })).toBe('ok');
  });

  it('moves only to its next published version, with the config version the server writes', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const MOVE =
        'UPDATE assure.checklist SET current_version = $2, updated_by = $3 WHERE id = $1';
      expect(await outcome(client, MOVE, [added.checklist, 3, added.member])).toBe('23514');
      expect(await outcome(client, MOVE, [added.checklist, 2, added.member])).toBe('23514');
      await insertRow(client, 'assure.checklist_version', {
        ...versionRow(tenant, added.checklist, added.member),
        version: 2,
      });
      await insertRow(client, 'assure.checklist_version', {
        ...versionRow(tenant, added.checklist, added.member),
        version: 3,
      });
      expect(await outcome(client, MOVE, [added.checklist, 3, added.member])).toBe('23514');
      await client.query(MOVE, [added.checklist, 2, added.member]);
      await insertRow(client, 'app.config_version', {
        tenant_id: tenant.id,
        entity_type: 'assure.checklist',
        entity_id: added.checklist,
        version: 2,
        author_id: added.member,
        diff: JSON.stringify({ items: [] }),
      });
      expect(await outcome(client, MOVE, [added.checklist, 1, added.member])).toBe('23514');
    });
  });

  it('starts with no current version', async () => {
    expect(
      await insertOutcome('app_api', tenant, 'assure.checklist', {
        tenant_id: tenant.id,
        name: 'Synthetic started checklist',
        current_version: 1,
        created_by: added.member,
        updated_by: added.member,
      }),
    ).toBe('42501');
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.checklist WHERE id = $1', [
      added.checklist,
    ]);
  });
});

describe('assure.checklist_version', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.checklist_version', async (client, row) => {
      const made = await addChecklist(client, row);
      return versionRow(row, made.checklist, made.member, { version: 2 });
    }));

  it.each([
    ['no items', []],
    ['an item without a stable id', [{ ...ITEMS[0], id: 'item-1' }]],
    ['an item of an unknown kind', [{ ...ITEMS[0], kind: 'signature' }]],
    ['an item without a label', [{ id: ITEM_ID, help: '', kind: 'date', required: false }]],
    ['more than 100 items', Array.from({ length: 101 }, () => ITEMS[0])],
  ])('refuses %s', async (_name, items) => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.checklist_version',
        versionRow(tenant, added.checklist, added.member, {
          version: 9,
          items: JSON.stringify(items),
        }),
      ),
    ).toBe('23514');
  });

  it("refuses another tenant's checklist, and a version number twice", async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.checklist_version',
        versionRow(tenant, strangers.added.checklist, added.member, { version: 9 }),
      ),
    ).toBe('23503');
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.checklist_version',
        versionRow(tenant, added.checklist, added.member),
      ),
    ).toBe('23505');
  });

  it('is immutable for every app role', async () => {
    for (const statement of [
      "UPDATE assure.checklist_version SET name = 'Changed' WHERE id = $1",
      'DELETE FROM assure.checklist_version WHERE id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [added.version]);
    }
  });
});

describe('assure.checklist_response', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.checklist_response', async (client, row) => {
      const made = await addChecklist(client, row);
      const { id } = await addApplication(client, row);
      return responseRow(row, id, made);
    }));

  it("refuses another tenant's application, a version of another checklist, and a second response", async () => {
    const { other, fresh } = await asMigratorIn(tenant.id, async (client) => ({
      other: await addChecklist(client, tenant),
      fresh: (await addApplication(client, tenant)).id,
    }));
    const insert = (change: Record<string, unknown>) =>
      insertOutcome(
        'app_api',
        tenant,
        'assure.checklist_response',
        responseRow(tenant, application, added, change),
      );
    expect(await insert({ application_id: strangers.application })).toBe('23503');
    expect(await insert({ application_id: fresh, checklist_version_id: other.version })).toBe(
      '23503',
    );
    expect(await insert({})).toBe('23505');
  });

  it.each([
    ['a file id in an answer', { [ITEM_ID]: { kind: 'file', fileIds: [ITEM_ID] } }],
    ['an array', [{ kind: 'yes_no', value: 'yes' }]],
    ['an answer of no kind', { [ITEM_ID]: { value: 'yes' } }],
  ])('refuses answers holding %s', async (_name, answers) => {
    const { id } = await asMigratorIn(tenant.id, (client) => addApplication(client, tenant));
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.checklist_response',
        responseRow(tenant, id, added, { answers: JSON.stringify(answers) }),
      ),
    ).toBe('23514');
  });

  it('keeps its pinned version and application once saved', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      for (const column of ['checklist_version_id', 'application_id', 'checklist_id']) {
        expect(
          await outcome(
            client,
            `UPDATE assure.checklist_response SET ${column} = ${column} WHERE id = $1`,
            [response],
          ),
          column,
        ).toBe('42501');
      }
      expect(
        await outcome(client, 'UPDATE assure.checklist_response SET answers = $2 WHERE id = $1', [
          response,
          JSON.stringify({ [ITEM_ID]: { kind: 'yes_no', value: 'yes' } }),
        ]),
      ).toBe('ok');
    });
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.checklist_response WHERE id = $1', [
      response,
    ]);
  });
});

describe('assure.checklist_response_file', { timeout: 30_000 }, () => {
  const fileRow = (file: string, change: Record<string, unknown> = {}) => ({
    tenant_id: tenant.id,
    response_id: response,
    item_id: ITEM_ID,
    file_id: file,
    created_by: added.member,
    ...change,
  });

  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.checklist_response_file', async (client, row) => {
      const made = await addResponse(client, row);
      return {
        tenant_id: row.id,
        response_id: made.response,
        item_id: ITEM_ID,
        file_id: await addFile(client, row, made.checklist.member),
        created_by: made.checklist.member,
      };
    }));

  it("refuses another tenant's file or response", async () => {
    const file = await asMigratorIn(tenant.id, (client) => addFile(client, tenant, added.member));
    const insert = (row: Record<string, unknown>) =>
      insertOutcome('app_api', tenant, 'assure.checklist_response_file', row);
    expect(await insert(fileRow(strangers.file))).toBe('23503');
    expect(await insert(fileRow(file, { response_id: strangers.response }))).toBe('23503');
  });

  it('links a clean file once, and releases it when the answer is replaced', async () => {
    const [clean, pending] = await asMigratorIn(tenant.id, async (client) => [
      await addFile(client, tenant, added.member),
      await addFile(client, tenant, added.member, 'pending'),
    ]);
    await asRoleIn('app_api', tenant.id, async (client) => {
      const { text, values } = {
        text: `INSERT INTO assure.checklist_response_file (tenant_id, response_id, item_id, file_id, created_by)
               VALUES ($1, $2, $3, $4, $5)`,
        values: (file: string) => [tenant.id, response, ITEM_ID, file, added.member],
      };
      expect(await outcome(client, text, values(pending))).toBe('55000');
      await client.query(text, values(clean));
      expect(await outcome(client, text, values(clean))).toBe('23505');
      await client.query('DELETE FROM assure.checklist_response_file WHERE file_id = $1', [clean]);
      const { rows } = await client.query<{ linked_at: Date | null; released_at: Date | null }>(
        'SELECT linked_at, released_at FROM app.file WHERE id = $1',
        [clean],
      );
      expect(rows[0]?.linked_at).toBeInstanceOf(Date);
      expect(rows[0]?.released_at).toBeInstanceOf(Date);
    });
  });

  it('is never changed in place', async () => {
    const file = await asMigratorIn(tenant.id, async (client) => {
      const id = await addFile(client, tenant, added.member);
      await insertRow(client, 'assure.checklist_response_file', fileRow(id));
      return id;
    });
    await expectEveryRoleRefused(
      tenant,
      'UPDATE assure.checklist_response_file SET item_id = item_id WHERE file_id = $1',
      [file],
    );
  });
});
