// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form builder routes through the whole API against the test database, as
// app_api, for two tenants: who may use them, another tenant's rounds and
// versions, starting and saving a draft, and importing a file. Field ids,
// publishing and discarding are in forms-publish.integration.test.ts.

import { randomUUID } from 'node:crypto';

import { formMessages } from '@pixel-scientists/domain/forms';
import {
  definitionBytes,
  FORM_DEFINITION_MAX_BYTES,
  formFileSchema,
  formVersionMessages,
  type FormVersion,
  type FormVersionList,
} from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  budget,
  everyRoute,
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
  storedVersions,
  type Problem,
  type Round,
  startProgrammeApi,
  type ProgrammeApi,
} from './programme-api.ts';
import { events } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let t: ProgrammeApi;
let f: FormsApi;

beforeAll(async () => {
  t = await startProgrammeApi('41020');
  f = formsApi(t);
}, 60_000);

afterAll(async () => {
  await t.close();
});

describe('who may use the form routes', () => {
  it('refuse a reviewer, an administrator, an applicant and a signed-out caller, and change nothing', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));
    const before = await f.countAll();

    for (const [method, url, body] of everyRoute(round.id, draft.id)) {
      for (const member of [t.reviewerA, t.adminA]) {
        const response = await t.send(member, method, url, body);
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(response.json<Problem>().detail).toBe('You do not have permission to do this.');
      }
      const applicant = await t.send(t.applicantA, method, url, body);
      expect(applicant.statusCode, `${method} ${url} as an applicant`).toBe(403);
      const inPortal = await t.send(t.managerA, method, url, body, 'portal');
      expect(inPortal.statusCode, `${method} ${url} in the portal`).toBe(403);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }

    expect(await f.countAll()).toEqual(before);
    expect(await f.read(draft.id)).toMatchObject({
      status: 'draft',
      definition: stored(form(title)),
    });
  });
});

describe('another tenant’s rounds and versions', () => {
  it('read as missing on every route, and nothing of theirs changes', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));
    const before = await f.countAll();
    const real = everyRoute(round.id, draft.id);
    const absent = everyRoute(randomUUID(), randomUUID());

    for (const [index, [method, url, body]] of real.entries()) {
      const outside = await t.send(t.managerB, method, url, body);
      const missing = await t.send(t.managerB, method, absent[index]?.[1] ?? '', body);
      expect(outside.statusCode, `${method} ${url}`).toBe(404);
      expectLooksMissing(outside, missing);
    }

    expect(await f.countAll()).toEqual(before);
    expect(await f.read(draft.id)).toMatchObject({
      status: 'draft',
      definition: stored(form(title)),
    });
  });

  it('keep each tenant’s versions to itself, with a draft of its own in the same numbering', async () => {
    const mine = await f.roundOfA();
    await f.start(mine);
    const programme = await answer<{ id: string }>(
      t.send(t.managerB, 'POST', '/console/programmes', {
        title: 'Tenant B fund',
        summary: 'Another funder’s programme.',
      }),
      201,
    );
    const theirRound = await answer<Round>(
      t.send(t.managerB, 'POST', `/console/programmes/${programme.id}/rounds`, {
        title: 'Spring',
        opensAt: '2026-10-20T09:00',
        closesAt: '2026-11-03T17:00',
        budget: { amountMinor: 5_000_000, currency: 'GBP' },
        awardMinimum: { amountMinor: 100_000, currency: 'GBP' },
        awardMaximum: { amountMinor: 2_500_000, currency: 'GBP' },
        latePolicy: 'refuse',
      }),
      201,
    );

    const theirs = await f.start(theirRound, t.managerB);
    const list = await answer<FormVersionList>(
      t.send(t.managerB, 'GET', `/console/rounds/${theirRound.id}/form-versions`),
    );

    expect(theirs.version).toBe(1);
    expect(list.versions.map((version) => version.id)).toEqual([theirs.id]);
    expect(await f.rowsOfRound(theirRound.id)).toEqual([]);
  });
});

describe('starting a draft', () => {
  it('starts empty for a round with no form, with an audit event', async () => {
    const round = await f.roundOfA();

    const draft = await f.start(round);

    expect(draft).toEqual({
      id: expect.any(String) as string,
      roundId: round.id,
      version: 1,
      status: 'draft',
      updatedAt: expect.any(String) as string,
      publishedAt: null,
      publishedBy: null,
      definition: null,
    });
    expect(await f.read(draft.id)).toEqual(draft);
    expect(
      await answer(t.send(t.managerA, 'GET', `/console/rounds/${round.id}/form-versions`)),
    ).toEqual({ versions: [{ ...draft, roundId: undefined, definition: undefined }] });
    const event = (await events(t.tenantA, 'grants.form_version.created')).find(
      (row) => row.entity_id === draft.id,
    );
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: {
        'grants.form_version.version': { before: null, after: 1 },
        'grants.form_version.status': { before: null, after: 'draft' },
      },
    });
    expect(await storedVersions(t.tenantA, 'grants.form_version', round.id)).toEqual([]);
  });

  it('refuses a second draft with a 409, also when two requests start one together', async () => {
    const round = await f.roundOfA();
    await f.start(round);

    const second = await t.send(t.managerA, 'POST', `/console/rounds/${round.id}/form-versions`);

    expect(second.statusCode).toBe(409);
    expect(second.json<Problem>().detail).toContain('already has a draft');
    expect(await f.rowsOfRound(round.id)).toHaveLength(1);

    const other = await f.roundOfA();
    const together = await Promise.all([
      t.send(t.managerA, 'POST', `/console/rounds/${other.id}/form-versions`),
      t.send(t.ada, 'POST', `/console/rounds/${other.id}/form-versions`),
    ]);
    expect(together.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await f.rowsOfRound(other.id)).toHaveLength(1);
  });

  it('answers 404 for a round that is not there', async () => {
    const response = await t.send(
      t.managerA,
      'POST',
      `/console/rounds/${randomUUID()}/form-versions`,
    );

    expect(response.statusCode).toBe(404);
  });

  it('copies the latest published definition, and the next version number', async () => {
    const round = await f.roundOfA();
    const first = await f.aPublished(round, title, budget);

    const second = await f.start(round);

    expect(second).toMatchObject({ version: 2, status: 'draft', publishedAt: null });
    expect(second.definition).toEqual(first.definition);
    const list = await answer<FormVersionList>(
      t.send(t.managerA, 'GET', `/console/rounds/${round.id}/form-versions`),
    );
    expect(list.versions.map(({ version, status }) => [version, status])).toEqual([
      [2, 'draft'],
      [1, 'published'],
    ]);
    expect(list.versions.every((version) => !('definition' in version))).toBe(true);
  });
});

describe('saving a draft', () => {
  it('stores the definition as the form engine parses it, and audits the change', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);

    const saved = await answer<FormVersion>(f.save(t.managerA, draft.id, form(title, budget)));

    expect(saved.definition).toEqual(stored(form(title, budget)));
    expect(saved.definition?.sections[0]?.fields[1]).toMatchObject({
      currency: 'GBP',
      minMinor: 0,
      audiences: ['applicant', 'staff', 'reviewer'],
    });
    expect(await f.read(draft.id)).toEqual(saved);
    const updates = (await events(t.tenantA, 'grants.form_version.updated')).filter(
      (row) => row.entity_id === draft.id,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: { 'grants.form_version.definition': {} },
    });
    expect(JSON.stringify(updates[0]?.changes)).not.toContain('Project title');
  });

  it('writes nothing when the definition has not changed, and replaces it when it has', async () => {
    const round = await f.roundOfA();
    const draft = await f.start(round);
    await answer(f.save(t.managerA, draft.id, form(title)));

    await answer(f.save(t.ada, draft.id, form(title)));
    const replaced = await answer<FormVersion>(f.save(t.ada, draft.id, form(title, notes)));

    expect(replaced.definition?.sections[0]?.fields.map((field) => field.id)).toEqual([
      'f_title',
      'f_notes',
    ]);
    const updates = (await events(t.tenantA, 'grants.form_version.updated')).filter(
      (row) => row.entity_id === draft.id,
    );
    expect(updates.map((row) => row.actor_id)).toEqual([
      t.managerA.membershipId,
      t.ada.membershipId,
    ]);
    expect(await storedVersions(t.tenantA, 'grants.form_version', round.id)).toEqual([]);
  });

  it('trims text and refuses what the form engine refuses, by field path, and changes nothing', async () => {
    const draft = await f.start(await f.roundOfA());
    const first = await answer<FormVersion>(f.save(t.managerA, draft.id, form(title)));
    const cases: [object, string, string][] = [
      [
        form(title, { ...budget, id: 'f_title' }),
        'body.definition.sections.0.fields.1.id',
        formMessages.idUsedTwice,
      ],
      [form({ ...title, label: '' }), 'body.definition.sections.0.fields.0.label', ''],
      [form({ ...title, label: '   ' }), 'body.definition.sections.0.fields.0.label', ''],
      [
        form({ ...title, label: 'Name\u202Eevil' }),
        'body.definition.sections.0.fields.0.label',
        '',
      ],
      [form({ ...title, colour: 'red' }), 'body.definition.sections.0.fields.0.colour', ''],
      [
        form(
          title,
          question('f_extra', 'yes_no', 'Extra?', {
            conditions: [{ field: 'f_later', equals: true }],
          }),
        ),
        'body.definition.sections.0.fields.1.conditions.0.field',
        formMessages.conditionSource,
      ],
      [{ sections: [] }, 'body.definition.sections', ''],
      [{ version: 2, ...form(title) }, 'body.definition.version', ''],
    ];

    for (const [definition, field, message] of cases) {
      const response = await f.save(t.managerA, draft.id, definition);
      expect(response.statusCode, JSON.stringify(definition)).toBe(400);
      const found = response.json<Problem>().errors?.find((error) => error.field === field);
      expect(found, `${field} for ${JSON.stringify(definition)}`).toBeDefined();
      if (message !== '') expect(found?.message).toBe(message);
    }
    const body = await t.send(t.managerA, 'PUT', `/console/form-versions/${draft.id}/definition`, {
      definition: form(title),
      roundId: randomUUID(),
    });
    expect(body.statusCode).toBe(400);

    const padded = await answer<FormVersion>(
      f.save(t.managerA, draft.id, form({ ...title, label: '  Project title  ' })),
    );
    expect(padded.definition).toEqual(first.definition);
    expect(await f.read(draft.id)).toEqual(padded);
  });

  it('takes a definition up to 256 KB, and refuses one over it with the limit’s message', async () => {
    const draft = await f.start(await f.roundOfA());
    const sections = (perSection: number) => ({
      sections: Array.from({ length: 3 }, (_, part) => ({
        id: `s_part${part}`,
        title: `Part ${part}`,
        fields: Array.from({ length: perSection }, (_, index) =>
          question(`f_q${index.toString(36)}p${part}`, 'long_text', 'Detail', {
            hint: 'x'.repeat(1000),
          }),
        ),
      })),
    });
    const fits = sections(60);
    const over = sections(100);
    expect(definitionBytes(stored(fits))).toBeLessThanOrEqual(FORM_DEFINITION_MAX_BYTES);
    expect(definitionBytes(stored(over))).toBeGreaterThan(FORM_DEFINITION_MAX_BYTES);

    const saved = await f.save(t.managerA, draft.id, fits);
    const refused = await f.save(t.managerA, draft.id, over);

    expect(saved.statusCode, saved.body).toBe(200);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().errors).toEqual([
      { field: 'body.definition', message: formVersionMessages.tooLarge },
    ]);
  });

  it('answers 404 for a version that is not there', async () => {
    const response = await f.save(t.managerA, randomUUID(), form(title));

    expect(response.statusCode).toBe(404);
  });
});

describe('importing a form file', () => {
  it('saves the file’s definition into the draft with the same checks', async () => {
    const draft = await f.start(await f.roundOfA());
    const file = formFileSchema.parse({
      format: 'form-definition',
      formatVersion: 1,
      definition: form(title, budget),
    });

    const saved = await answer<FormVersion>(f.save(t.managerA, draft.id, file.definition));

    expect(saved.definition).toEqual(stored(form(title, budget)));
    const broken = form(title, question('f_dupe', 'short_text', 'Again', { id: 'f_title' }));
    expect(
      formFileSchema.safeParse({ format: 'form-definition', formatVersion: 1, definition: broken })
        .success,
    ).toBe(false);
    const refused = await f.save(t.managerA, draft.id, broken);
    expect(refused.statusCode).toBe(400);
    expect(await f.read(draft.id)).toEqual(saved);
  });
});
