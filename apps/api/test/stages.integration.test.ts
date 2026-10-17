// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The stage and rubric routes through the whole API against the test
// database, as app_api: reordering in one transaction, replacing a rubric,
// and refusing to remove what anything refers to.

import { randomUUID } from 'node:crypto';

import { programmeMessages } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { asMigratorIn } from '../../../packages/db/test/tenants.ts';
import {
  answer,
  criterionBody,
  rowsOf,
  startProgrammeApi,
  storedVersions,
  type Problem,
  type ProgrammeApi,
  type Stage,
} from './programme-api.ts';
import { events } from './settings-api.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

/** A table that refers to stages and criteria, as applications and scores will. */
const REFERENCE = 'grants.zz_stage_test_reference';

let t: ProgrammeApi;

beforeAll(async () => {
  t = await startProgrammeApi('41012');
  await asMigratorIn(t.tenantA.id, (client) =>
    client.query(`
      DROP TABLE IF EXISTS ${REFERENCE};
      CREATE TABLE ${REFERENCE} (
        stage_id uuid REFERENCES grants.stage (id),
        criterion_id uuid REFERENCES grants.rubric_criterion (id))`),
  );
}, 60_000);

afterAll(async () => {
  await asMigratorIn(t.tenantA.id, (client) => client.query(`DROP TABLE IF EXISTS ${REFERENCE}`));
  await t.close();
});

const putStages = (roundId: string, stages: object[]) =>
  t.send(t.managerA, 'PUT', `/console/rounds/${roundId}/stages`, { stages });

describe('stages', () => {
  it('renames, reorders, adds and removes stages in one change, with a version of the round', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [intake, review, decision] = await t.stagesOf(round.id);

    const response = await answer<{ stages: Stage[] }>(
      putStages(round.id, [
        { id: decision?.id, name: 'Intake' },
        { id: intake?.id, name: 'Eligibility' },
        { name: 'Panel' },
      ]),
    );

    // The names move between stages and the order changes in one request; Review is gone.
    expect(response.stages.map(({ name, position }) => [name, position])).toEqual([
      ['Intake', 1],
      ['Eligibility', 2],
      ['Panel', 3],
    ]);
    expect(response.stages.slice(0, 2).map((stage) => stage.id)).toEqual([
      decision?.id,
      intake?.id,
    ]);
    expect(response.stages.map((stage) => stage.id)).not.toContain(review?.id);
    expect(await t.stagesOf(round.id)).toEqual(response.stages);

    const versions = await storedVersions(t.tenantA, 'grants.round', round.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({ author_id: t.managerA.membershipId });
    expect(versions[1]?.diff.changes).toContainEqual({
      path: `stages.${intake?.id}.name`,
      from: 'Intake',
      to: 'Eligibility',
    });
    expect(versions[1]?.diff.changes).toContainEqual({
      path: `stages.${decision?.id}.position`,
      from: 3,
      to: 1,
    });
    expect(versions[1]?.diff.changes).toContainEqual({
      path: `stages.${review?.id}.name`,
      from: 'Review',
      to: null,
    });
    const audit = (await events(t.tenantA, 'grants.round.stages_changed')).filter(
      (row) => row.entity_id === round.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: { 'grants.stage.name': {}, 'grants.stage.position': {} },
    });
  });

  it('writes nothing for the stages as they are', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const stages = await t.stagesOf(round.id);

    await answer(
      putStages(
        round.id,
        stages.map(({ id, name }) => ({ id, name })),
      ),
    );

    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
    expect(await t.stagesOf(round.id)).toEqual(stages);
  });

  it('refuses a repeated name or id, a missing name, a wrong count and extra keys, and changes nothing', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const stages = await t.stagesOf(round.id);
    const id = stages[0]?.id;
    const cases: [object[], string | undefined][] = [
      [[{ name: 'Intake' }, { name: 'intake' }], programmeMessages.stageNamesUnique],
      [
        [
          { id, name: 'A' },
          { id, name: 'B' },
        ],
        programmeMessages.listedOnce,
      ],
      [[{ name: '  ' }], programmeMessages.stageName],
      [[], undefined],
      [Array.from({ length: 11 }, (_, index) => ({ name: `Stage ${index}` })), undefined],
      [[{ name: 'Intake', position: 1 }], undefined],
    ];
    for (const [body, message] of cases) {
      const response = await putStages(round.id, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      if (message !== undefined) {
        expect(response.json<Problem>().errors?.map((error) => error.message)).toContain(message);
      }
    }
    expect(await t.stagesOf(round.id)).toEqual(stages);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
  });

  it('answers 404 and changes nothing for a stage that is not in the round', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const other = await t.aRound((await t.aProgramme()).id);
    const [foreign] = await t.stagesOf(other.id);
    const before = await t.stagesOf(round.id);

    const response = await putStages(round.id, [
      ...before.map(({ id, name }) => ({ id, name: `${name} 2` })),
      { id: foreign?.id, name: 'Fourth' },
    ]);

    expect(response.statusCode).toBe(404);
    expect(await t.stagesOf(round.id)).toEqual(before);
    expect(await t.stagesOf(other.id)).toHaveLength(3);
  });

  it('removes a stage with its rubric, and refuses with 409 one that anything refers to', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [intake, review, decision] = await t.stagesOf(round.id);
    await answer(
      t.send(t.managerA, 'PUT', `/console/stages/${review?.id}/rubric`, {
        criteria: [criterionBody('Need')],
      }),
    );
    await asMigratorIn(t.tenantA.id, (client) =>
      client.query(`INSERT INTO ${REFERENCE} (stage_id) VALUES ($1)`, [decision?.id]),
    );
    const before = await t.stagesOf(round.id);
    const keep = (...kept: (Stage | undefined)[]) =>
      kept.map((stage) => ({ id: stage?.id, name: stage?.name }));

    const refused = await putStages(round.id, keep(intake, review));
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toBe(
      'This stage has applications or reviews in it, so it cannot be removed. Keep the stage, or rename it.',
    );
    expect(await t.stagesOf(round.id)).toEqual(before);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(2);

    const removed = await answer<{ stages: Stage[] }>(putStages(round.id, keep(intake, decision)));
    expect(removed.stages.map((stage) => stage.name)).toEqual(['Intake', 'Decision']);
    expect(
      await rowsOf(t.tenantA, 'SELECT id FROM grants.rubric_criterion WHERE stage_id = $1', [
        review?.id,
      ]),
    ).toEqual([]);
  });
});

describe('rubrics', () => {
  const rubricUrl = (stage: Stage | undefined) => `/console/stages/${stage?.id}/rubric`;

  it('replaces a stage’s criteria, keeping those with an id, and records each value', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);

    const first = await answer<Stage>(
      t.send(t.ada, 'PUT', rubricUrl(review), {
        criteria: [
          criterionBody('Need'),
          criterionBody('Reach', { weight: 3 }),
          criterionBody('Value', { scaleMin: 0, scaleMax: 10 }),
        ],
      }),
    );

    expect(first).toMatchObject({ id: review?.id, name: 'Review', position: 2 });
    expect(
      first.criteria.map(({ label, weight, scaleMin, scaleMax }) => [
        label,
        weight,
        scaleMin,
        scaleMax,
      ]),
    ).toEqual([
      ['Need', 2, 1, 5],
      ['Reach', 3, 1, 5],
      ['Value', 2, 0, 10],
    ]);
    const [need, reach, value] = first.criteria;
    const created = (await storedVersions(t.tenantA, 'grants.round', round.id))[1];
    expect(created).toMatchObject({ version: 2, author_id: t.ada.membershipId });
    expect(created?.diff.changes).toContainEqual({
      path: `stages.${review?.id}.criteria.${reach?.id}.weight`,
      from: null,
      to: 3,
    });
    expect(created?.diff.changes).toHaveLength(18);

    const second = await answer<Stage>(
      t.send(t.managerA, 'PUT', rubricUrl(review), {
        criteria: [
          { ...criterionBody('Value for money', { weight: 5 }), id: value?.id },
          { ...criterionBody('Need'), id: need?.id },
          criterionBody('Fit'),
        ],
      }),
    );

    expect(second.criteria.map((criterion) => criterion.label)).toEqual([
      'Value for money',
      'Need',
      'Fit',
    ]);
    expect(second.criteria.slice(0, 2).map((criterion) => criterion.id)).toEqual([
      value?.id,
      need?.id,
    ]);
    expect(second.criteria.map((criterion) => criterion.id)).not.toContain(reach?.id);
    expect((await t.stagesOf(round.id))[1]).toEqual(second);

    const versions = await storedVersions(t.tenantA, 'grants.round', round.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    const changes = versions[2]?.diff.changes ?? [];
    const base = `stages.${review?.id}.criteria`;
    expect(changes).toContainEqual({
      path: `${base}.${value?.id}.label`,
      from: 'Value',
      to: 'Value for money',
    });
    expect(changes).toContainEqual({ path: `${base}.${value?.id}.weight`, from: 2, to: 5 });
    expect(changes).toContainEqual({ path: `${base}.${value?.id}.position`, from: 3, to: 1 });
    expect(changes).toContainEqual({ path: `${base}.${reach?.id}.label`, from: 'Reach', to: null });
    expect(changes.some((change) => change.path.startsWith(`${base}.${need?.id}.label`))).toBe(
      false,
    );
    const audit = (await events(t.tenantA, 'grants.stage.rubric_changed')).filter(
      (row) => row.entity_id === review?.id,
    );
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: {
        'grants.rubric_criterion.label': {},
        'grants.rubric_criterion.weight': {},
        'grants.rubric_criterion.position': {},
      },
    });
    expect(JSON.stringify(audit)).not.toContain('Value for money');
  });

  it('writes nothing for the rubric as it is, and removes every criterion with an empty list', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);
    const set = await answer<Stage>(
      t.send(t.managerA, 'PUT', rubricUrl(review), { criteria: [criterionBody('Need')] }),
    );

    await answer(t.send(t.managerA, 'PUT', rubricUrl(review), { criteria: set.criteria }));
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(2);

    const emptied = await answer<Stage>(
      t.send(t.managerA, 'PUT', rubricUrl(review), { criteria: [] }),
    );
    expect(emptied.criteria).toEqual([]);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(3);
  });

  it('refuses with 409 to remove a criterion that anything refers to, and changes nothing', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);
    const set = await answer<Stage>(
      t.send(t.managerA, 'PUT', rubricUrl(review), {
        criteria: [criterionBody('Need'), criterionBody('Reach')],
      }),
    );
    const [need, reach] = set.criteria;
    await asMigratorIn(t.tenantA.id, (client) =>
      client.query(`INSERT INTO ${REFERENCE} (criterion_id) VALUES ($1)`, [need?.id]),
    );

    const refused = await t.send(t.managerA, 'PUT', rubricUrl(review), {
      criteria: [{ ...criterionBody('Reach, reworded'), id: reach?.id }, criterionBody('New')],
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json<Problem>().detail).toBe(
      'Reviewers have already scored this criterion, so it cannot be removed. Keep it in the list, or change its wording.',
    );
    expect((await t.stagesOf(round.id))[1]).toEqual(set);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(2);

    const kept = await answer<Stage>(
      t.send(t.managerA, 'PUT', rubricUrl(review), {
        criteria: [{ ...criterionBody('Need, reworded'), id: need?.id }],
      }),
    );
    expect(kept.criteria.map((criterion) => criterion.id)).toEqual([need?.id]);
  });

  it('answers 404 and changes nothing for a criterion that is not in the stage', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);

    const response = await t.send(t.managerA, 'PUT', rubricUrl(review), {
      criteria: [{ ...criterionBody('Need'), id: randomUUID() }],
    });

    expect(response.statusCode).toBe(404);
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
  });

  it('refuses each check in the contract with its message, and changes nothing', async () => {
    const round = await t.aRound((await t.aProgramme()).id);
    const [, review] = await t.stagesOf(round.id);
    const id = randomUUID();
    const cases: [object, string, string | undefined][] = [
      [
        { criteria: [criterionBody('')] },
        'body.criteria.0.label',
        programmeMessages.criterionLabel,
      ],
      [{ criteria: [criterionBody('Need', { weight: 0 })] }, 'body.criteria.0.weight', undefined],
      [{ criteria: [criterionBody('Need', { weight: 101 })] }, 'body.criteria.0.weight', undefined],
      [
        { criteria: [criterionBody('Need', { scaleMin: 5, scaleMax: 5 })] },
        'body.criteria.0.scaleMax',
        programmeMessages.scale,
      ],
      [
        { criteria: [criterionBody('Need', { scaleMax: 11 })] },
        'body.criteria.0.scaleMax',
        undefined,
      ],
      [
        { criteria: [criterionBody('Need', { guidance: 'x'.repeat(1001) })] },
        'body.criteria.0.guidance',
        undefined,
      ],
      [
        { criteria: Array.from({ length: 21 }, (_, index) => criterionBody(`C${index}`)) },
        'body.criteria',
        undefined,
      ],
      [
        {
          criteria: [
            { ...criterionBody('A'), id },
            { ...criterionBody('B'), id },
          ],
        },
        'body.criteria.1.id',
        programmeMessages.listedOnce,
      ],
    ];
    for (const [body, field, message] of cases) {
      const response = await t.send(t.managerA, 'PUT', rubricUrl(review), body);
      expect(response.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      const found = response.json<Problem>().errors?.find((error) => error.field === field);
      expect(found, field).toBeDefined();
      if (message !== undefined) expect(found?.message).toBe(message);
    }
    expect(await storedVersions(t.tenantA, 'grants.round', round.id)).toHaveLength(1);
  });
});
