// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form builder routes through the whole API against the test database, as
// app_api: field ids across versions, publishing with its configuration
// version and audit event, published versions that cannot change, and
// discarding a draft. The rest is in forms.integration.test.ts.

import { randomUUID } from 'node:crypto';

import { messages } from '@pixel-scientists/domain/platform';
import type { FormVersion, FormVersionList } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  budget,
  form,
  notes,
  question,
  stored,
  title,
  formsApi,
  type FormsApi,
} from './forms-api.ts';
import {
  answer,
  rowsOf,
  storedVersions,
  type Problem,
  startProgrammeApi,
  type ProgrammeApi,
} from './programme-api.ts';
import { events } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ProgrammeApi;
let f: FormsApi;

beforeAll(async () => {
  t = await startProgrammeApi('41021');
  f = formsApi(t);
}, 60_000);

afterAll(async () => {
  await t.close();
});

describe('field ids across versions', () => {
  it('refuse an id used before with another type, naming it', async () => {
    const round = await f.roundOfA();
    await f.aPublished(round, title, budget);
    const draft = await f.start(round);

    const response = await f.save(t.managerA, draft.id, form(title, { ...budget, type: 'number' }));

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>()).toMatchObject({
      detail: messages.fixFields,
      errors: [
        {
          field: 'body.definition.sections.0.fields.1.type',
          message: expect.stringContaining('f_budget') as string,
        },
      ],
    });
    const kept = await answer<FormVersion>(
      f.save(t.managerA, draft.id, form(title, { ...budget, label: 'Total project cost' })),
    );
    expect(kept.definition?.sections[0]?.fields[1]).toMatchObject({
      id: 'f_budget',
      type: 'currency',
    });
  });

  it('refuse a removed id that returns with another type, and a table column that changes type', async () => {
    const round = await f.roundOfA();
    const costs = (amount: object) =>
      question('f_costs', 'table', 'Costs', {
        rowNoun: 'cost',
        columns: [question('c_item', 'short_text', 'Item'), { id: 'c_amount', ...amount }],
      });
    await f.aPublished(round, title, budget, costs({ type: 'currency', label: 'Amount' }));
    const second = await f.start(round);
    await answer(f.save(t.managerA, second.id, form(title)));
    await f.publish(t.managerA, second.id);
    const third = await f.start(round);

    const returned = await f.save(
      t.managerA,
      third.id,
      form(title, { ...budget, type: 'short_text' }),
    );
    const column = await f.save(
      t.managerA,
      third.id,
      form(title, costs({ type: 'number', label: 'Amount' })),
    );

    expect(returned.statusCode).toBe(400);
    expect(returned.json<Problem>().errors).toEqual([
      expect.objectContaining({ field: 'body.definition.sections.0.fields.1.type' }),
    ]);
    expect(column.statusCode).toBe(400);
    expect(column.json<Problem>().errors).toEqual([
      {
        field: 'body.definition.sections.0.fields.1.columns.1.type',
        message: expect.stringContaining('c_amount') as string,
      },
    ]);
    const back = await f.save(t.managerA, third.id, form(title, budget));
    expect(back.statusCode).toBe(200);
  });
});

describe('publishing a draft', () => {
  it('fixes the version with its time and author, writes a configuration version and an event', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title, budget)));

    const published = await answer<FormVersion>(
      t.send(t.ada, 'POST', `/console/form-versions/${draft.id}/publish`),
    );

    expect(published).toMatchObject({
      id: draft.id,
      version: 1,
      status: 'published',
      publishedAt: expect.any(String) as string,
      publishedBy: { membershipId: t.ada.membershipId, name: 'Ada Lovelace' },
      definition: stored(form(title, budget)),
    });
    expect(await f.read(draft.id)).toEqual(published);
    const versions = await storedVersions(t.tenantA, 'grants.form_version', round.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      author_id: t.ada.membershipId,
      entity_id: round.id,
    });
    const changes = Object.fromEntries(
      versions[0]?.diff.changes.map((change) => [change.path, [change.from, change.to]]) ?? [],
    );
    expect(changes).toMatchObject({
      'sections.s_about.title': [null, 'About your project'],
      'sections.s_about.position': [null, 1],
      'sections.s_about.fields': [null, 'f_title,f_budget'],
      'fields.f_title.type': [null, 'short_text'],
      'fields.f_title.required': [null, true],
      'fields.f_budget.type': [null, 'currency'],
      'fields.f_budget.currency': [null, 'GBP'],
      'fields.f_budget.audiences': [null, '["applicant","staff","reviewer"]'],
    });
    const event = (await events(t.tenantA, 'grants.form_version.published')).find(
      (row) => row.entity_id === draft.id,
    );
    expect(event).toMatchObject({
      actor_id: t.ada.membershipId,
      changes: {
        'grants.form_version.status': { before: 'draft', after: 'published' },
        'grants.form_version.version': { before: null, after: 1 },
      },
    });
    expect(JSON.stringify(event?.changes)).not.toContain('Project title');
  });

  it('records the changes from the previous published version, none when nothing changed', async () => {
    const round = await f.roundOfA();
    await f.aPublished(round, title, budget);
    const second = await f.start(round);
    await answer(f.save(t.managerA, second.id, form({ ...title, label: 'Project name' }, notes)));

    await f.publish(t.managerA, second.id);
    const third = await f.start(round);
    await f.publish(t.managerA, third.id);

    const versions = await storedVersions(t.tenantA, 'grants.form_version', round.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    const changes = Object.fromEntries(
      versions[1]?.diff.changes.map((change) => [change.path, [change.from, change.to]]) ?? [],
    );
    expect(changes).toEqual({
      'sections.s_about.fields': ['f_title,f_budget', 'f_title,f_notes'],
      'fields.f_title.label': ['Project title', 'Project name'],
      'fields.f_budget.type': ['currency', null],
      'fields.f_budget.label': ['Total cost', null],
      'fields.f_budget.required': [false, null],
      'fields.f_budget.identity': [false, null],
      'fields.f_budget.audiences': ['["applicant","staff","reviewer"]', null],
      'fields.f_budget.conditions': ['[]', null],
      'fields.f_budget.currency': ['GBP', null],
      'fields.f_budget.minMinor': [0, null],
      'fields.f_notes.type': [null, 'long_text'],
      'fields.f_notes.label': [null, 'Anything else?'],
      'fields.f_notes.required': [null, false],
      'fields.f_notes.identity': [null, false],
      'fields.f_notes.audiences': [null, '["applicant","staff","reviewer"]'],
      'fields.f_notes.conditions': [null, '[]'],
    });
    expect(versions[2]?.diff.changes).toEqual([]);
    const list = await answer<FormVersionList>(
      t.send(t.managerA, 'GET', `/console/rounds/${round.id}/form-versions`),
    );
    expect(list.versions.map(({ version, status }) => [version, status])).toEqual([
      [3, 'published'],
      [2, 'published'],
      [1, 'published'],
    ]);
  });

  it('refuses a draft with nothing saved, and a published version again, with a 409', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    const empty = await t.send(t.managerA, 'POST', `/console/form-versions/${draft.id}/publish`);
    await answer(f.save(t.managerA, draft.id, form(title)));
    await f.publish(t.managerA, draft.id);

    const again = await t.send(t.managerA, 'POST', `/console/form-versions/${draft.id}/publish`);

    expect(empty.statusCode).toBe(409);
    expect(again.statusCode).toBe(409);
    expect(await storedVersions(t.tenantA, 'grants.form_version', round.id)).toHaveLength(1);
  });

  it('publishes once when two requests publish together', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));

    const together = await Promise.all([
      t.send(t.managerA, 'POST', `/console/form-versions/${draft.id}/publish`),
      t.send(t.ada, 'POST', `/console/form-versions/${draft.id}/publish`),
    ]);

    expect(together.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await storedVersions(t.tenantA, 'grants.form_version', round.id)).toHaveLength(1);
    const published = (await events(t.tenantA, 'grants.form_version.published')).filter(
      (row) => row.entity_id === draft.id,
    );
    expect(published).toHaveLength(1);
  });

  it('publishes the draft as it was last saved, whichever of a save and a publication comes first', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));

    const [saved, published] = await Promise.all([
      f.save(t.ada, draft.id, form(title, notes)),
      t.send(t.managerA, 'POST', `/console/form-versions/${draft.id}/publish`),
    ]);

    expect(published.statusCode).toBe(200);
    expect([200, 409]).toContain(saved.statusCode);
    const lastSaved = saved.statusCode === 200 ? form(title, notes) : form(title);
    expect(published.json<FormVersion>().definition).toEqual(stored(lastSaved));
    expect((await f.read(draft.id)).definition).toEqual(stored(lastSaved));
  });

  it('checks the stored definition again, naming what is wrong by path', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));
    await rowsOf(
      t.tenantA,
      `UPDATE grants.form_version SET definition = jsonb_set(definition, '{sections,0,fields,0,id}', '"bad"') WHERE id = $1`,
      [draft.id],
    );

    const response = await t.send(t.managerA, 'POST', `/console/form-versions/${draft.id}/publish`);

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ field: 'definition.sections.0.fields.0.id' }),
    ]);
    expect((await f.rowsOfRound(round.id)).map((row) => row.status)).toEqual(['draft']);
    expect(await storedVersions(t.tenantA, 'grants.form_version', round.id)).toEqual([]);
  });
});

describe('a published version', () => {
  it('cannot be saved, published or discarded, and stays as it was', async () => {
    const round = await f.roundOfA();
    const published = await f.aPublished(round, title);
    const before = await f.rowsOfRound(round.id);

    const attempts = await Promise.all([
      f.save(t.managerA, published.id, form(title, budget)),
      t.send(t.managerA, 'POST', `/console/form-versions/${published.id}/publish`),
      t.send(t.managerA, 'DELETE', `/console/form-versions/${published.id}`),
    ]);

    expect(attempts.map((response) => response.statusCode)).toEqual([409, 409, 409]);
    expect(await f.read(published.id)).toEqual(published);
    expect(await f.rowsOfRound(round.id)).toEqual(before);
    expect(
      (await events(t.tenantA, 'grants.form_version.updated')).filter(
        (row) => row.entity_id === published.id,
      ),
    ).toHaveLength(1);
  });
});

describe('discarding a draft', () => {
  it('removes it, writes its event, and lets the next draft take its number', async () => {
    const round = await f.roundOfA();
    await f.aPublished(round, title);
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title, budget)));

    const response = await t.send(t.ada, 'DELETE', `/console/form-versions/${draft.id}`);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await t.send(t.managerA, 'GET', `/console/form-versions/${draft.id}`)).statusCode).toBe(
      404,
    );
    expect((await f.rowsOfRound(round.id)).map((row) => [row.version, row.status])).toEqual([
      [1, 'published'],
    ]);
    const event = (await events(t.tenantA, 'grants.form_version.discarded')).find(
      (row) => row.entity_id === draft.id,
    );
    expect(event).toMatchObject({
      actor_id: t.ada.membershipId,
      changes: { 'grants.form_version.version': { before: 2, after: null } },
    });
    expect((await f.start(round)).version).toBe(2);
  });

  it('answers 404 for a version that is not there', async () => {
    const response = await t.send(t.managerA, 'DELETE', `/console/form-versions/${randomUUID()}`);

    expect(response.statusCode).toBe(404);
  });
});
