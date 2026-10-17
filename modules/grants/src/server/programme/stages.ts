// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The stage and rubric routes' handlers. A round's stages and their rubrics
// are part of the round's configuration history, so a change to either
// writes a version of the round. A stage or criterion that applications or
// scores refer to cannot be removed: the database refuses it, and the
// request answers 409 and changes nothing.

import {
  configDiff,
  type RubricInput,
  type Stage,
  type StageList,
  type StagesInput,
} from '../../contracts/index.ts';
import { recordConfig } from './change.ts';
import type { Args, GrantsDependencies, RoundParams } from './context.ts';
import { readCriteria, readRound, readStages } from './read.ts';
import { grantsDb, isInUse } from './tables.ts';
import { stageFields, stageValues } from './values.ts';

const STAGE_IN_USE =
  'This stage has applications or reviews in it, so it cannot be removed. Keep the stage, or rename it.';

const CRITERION_IN_USE =
  'Reviewers have already scored this criterion, so it cannot be removed. Keep it in the list, or change its wording.';

const criterionColumns = (
  { label, guidance, weight, scaleMin, scaleMax }: RubricInput['criteria'][number],
  position: number,
) => ({ label, guidance, weight, scale_min: scaleMin, scale_max: scaleMax, position });

export function stageHandlers(deps: GrantsDependencies) {
  async function listStages({ tx, input }: Args<RoundParams>): Promise<StageList> {
    const { roundId } = input.params;
    if ((await readRound(tx, roundId)) === undefined) throw deps.notFound();
    return { stages: await readStages(tx, roundId) };
  }

  /** Runs `removal`, answering 409 with `message` if anything still refers to what it removes. */
  async function removing(message: string, removal: () => Promise<unknown>): Promise<void> {
    try {
      await removal();
    } catch (error) {
      throw isInUse(error) ? deps.refuse(409, message) : error;
    }
  }

  async function setStages({
    tx,
    context,
    input,
  }: Args<RoundParams & { body: StagesInput }>): Promise<StageList> {
    const { roundId } = input.params;
    const db = grantsDb(tx);
    const actor = context.membership.id;
    if ((await readRound(tx, roundId, true)) === undefined) throw deps.notFound();

    const before = await readStages(tx, roundId);
    const known = new Set(before.map((stage) => stage.id));
    const { stages } = input.body;
    if (stages.some(({ id }) => id !== undefined && !known.has(id))) throw deps.notFound();

    const kept = new Set(stages.flatMap(({ id }) => id ?? []));
    const removed = before.filter(({ id }) => !kept.has(id)).map(({ id }) => id);
    if (removed.length > 0) {
      await removing(STAGE_IN_USE, async () => {
        await db.deleteFrom('grants.rubric_criterion').where('stage_id', 'in', removed).execute();
        await db.deleteFrom('grants.stage').where('id', 'in', removed).execute();
      });
    }

    const current = new Map(before.map((stage) => [stage.id, stage]));
    for (const [index, { id, name }] of stages.entries()) {
      const position = index + 1;
      const stage = id === undefined ? undefined : current.get(id);
      if (stage === undefined) {
        await db
          .insertInto('grants.stage')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            round_id: roundId,
            name,
            position,
            created_by: actor,
            updated_by: actor,
          }))
          .execute();
      } else if (stage.name !== name || stage.position !== position) {
        await db
          .updateTable('grants.stage')
          .set({ name, position, updated_by: actor })
          .where('id', '=', stage.id)
          .execute();
      }
    }

    const after = await readStages(tx, roundId);
    const diff = configDiff(stageValues(before), stageValues(after));
    if (diff.length > 0) {
      await recordConfig(deps, tx, context, 'grants.round', roundId, diff);
      await context.audit.record({
        action: 'grants.round.stages_changed',
        entityId: roundId,
        changes: stageFields(diff),
      });
    }
    return { stages: after };
  }

  async function setRubric({
    tx,
    context,
    input,
  }: Args<{ params: { stageId: string }; body: RubricInput }>): Promise<Stage> {
    const { stageId } = input.params;
    const db = grantsDb(tx);
    const actor = context.membership.id;
    const stage = await db
      .selectFrom('grants.stage')
      .select('round_id')
      .where('id', '=', stageId)
      .executeTakeFirst();
    if (stage === undefined) throw deps.notFound();
    const roundId = stage.round_id;
    // Locks the round, so its set-up changes one request at a time.
    await readRound(tx, roundId, true);

    const before = (await readStages(tx, roundId)).find(({ id }) => id === stageId);
    if (before === undefined) throw deps.notFound();
    const known = new Set(before.criteria.map(({ id }) => id));
    const { criteria } = input.body;
    if (criteria.some(({ id }) => id !== undefined && !known.has(id))) throw deps.notFound();

    const kept = new Set(criteria.flatMap(({ id }) => id ?? []));
    const removed = [...known].filter((id) => !kept.has(id));
    if (removed.length > 0) {
      await removing(CRITERION_IN_USE, () =>
        db.deleteFrom('grants.rubric_criterion').where('id', 'in', removed).execute(),
      );
    }

    for (const [index, criterion] of criteria.entries()) {
      const columns = criterionColumns(criterion, index + 1);
      if (criterion.id === undefined) {
        await db
          .insertInto('grants.rubric_criterion')
          .values((eb) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            stage_id: stageId,
            ...columns,
            created_by: actor,
            updated_by: actor,
          }))
          .execute();
      } else {
        await db
          .updateTable('grants.rubric_criterion')
          .set({ ...columns, updated_by: actor })
          .where('id', '=', criterion.id)
          .execute();
      }
    }

    const after = { ...before, criteria: (await readCriteria(tx, [stageId])).get(stageId) ?? [] };
    const diff = configDiff(stageValues([before]), stageValues([after]));
    if (diff.length > 0) {
      await recordConfig(deps, tx, context, 'grants.round', roundId, diff);
      await context.audit.record({
        action: 'grants.stage.rubric_changed',
        entityId: stageId,
        changes: stageFields(diff),
      });
    }
    return after;
  }

  return { listStages, setStages, setRubric };
}
