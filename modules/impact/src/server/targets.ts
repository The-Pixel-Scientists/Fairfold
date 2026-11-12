// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The target routes' handlers. A target is configuration a member sets for
// an indicator, so each change writes an audit event with the figures; it
// has no configuration version of its own.

import {
  impactRefusals,
  type Target,
  type TargetInput,
  type TargetList,
  type TargetUpdate,
} from '../contracts/index.ts';
import {
  figure,
  impactDb,
  iso,
  isTaken,
  type Args,
  type FrameworkParams,
  type ImpactDb,
  type ImpactDependencies,
} from './context.ts';
import { readFrameworkRow, writeChecks } from './read.ts';

export interface TargetParams {
  readonly params: { readonly targetId: string };
}

/** Targets with their dates as text, so no time zone touches them. */
const selectTargets = (db: ImpactDb) =>
  db
    .selectFrom('impact.target as t')
    .select((eb) => [
      't.id',
      't.framework_id',
      't.indicator_id',
      't.programme_id',
      eb.cast<string>('t.period_start', 'text').as('period_start'),
      eb.cast<string>('t.period_end', 'text').as('period_end'),
      't.baseline',
      't.target',
      't.created_at',
      't.updated_at',
    ]);

type TargetRow = Awaited<ReturnType<ReturnType<typeof selectTargets>['executeTakeFirstOrThrow']>>;

const toTarget = (row: TargetRow): Target => ({
  id: row.id,
  frameworkId: row.framework_id,
  indicatorId: row.indicator_id,
  programmeId: row.programme_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  baseline: row.baseline === null ? null : figure(row.baseline),
  target: figure(row.target),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export function targetHandlers(deps: ImpactDependencies) {
  const checks = writeChecks(deps);

  const readTarget = async (db: ImpactDb, targetId: string): Promise<Target> => {
    const row = await selectTargets(db).where('t.id', '=', targetId).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toTarget(row);
  };

  /** For a replay of the set: the target as it reads now. */
  const getTarget = ({ tx, input }: Args<TargetParams>): Promise<Target> =>
    readTarget(impactDb(tx), input.params.targetId);

  async function listTargets({ tx, input }: Args<FrameworkParams>): Promise<TargetList> {
    const { frameworkId } = input.params;
    if ((await readFrameworkRow(tx, frameworkId)) === undefined) throw deps.notFound();
    const rows = await selectTargets(impactDb(tx))
      .innerJoin('impact.indicator as i', 'i.id', 't.indicator_id')
      .where('t.framework_id', '=', frameworkId)
      .orderBy('i.position')
      .orderBy('t.indicator_id')
      .orderBy('t.period_start')
      .orderBy('t.period_end')
      .orderBy('t.id')
      .execute();
    return { targets: rows.map(toTarget) };
  }

  async function createTarget({
    tx,
    context,
    input,
  }: Args<{ body: TargetInput }>): Promise<Target> {
    const db = impactDb(tx);
    const actor = context.membership.id;
    const { frameworkId, indicatorId, programmeId, periodStart, periodEnd, baseline, target } =
      input.body;
    await checks.openFramework(tx, frameworkId);
    const unit = await checks.indicatorUnit(tx, frameworkId, indicatorId);
    checks.checkFigures(unit, [baseline, target]);
    await checks.checkProgramme(tx, programmeId);

    let id: string;
    try {
      ({ id } = await db
        .insertInto('impact.target')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          framework_id: frameworkId,
          indicator_id: indicatorId,
          programme_id: programmeId,
          period_start: periodStart,
          period_end: periodEnd,
          baseline,
          target,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, impactRefusals.targetExists) : error;
    }
    await context.audit.record({
      action: 'impact.target.set',
      entityId: id,
      changes: {
        'impact.target.indicator_id': { after: indicatorId },
        'impact.target.programme_id': { after: programmeId },
        'impact.target.period_start': { after: periodStart },
        'impact.target.period_end': { after: periodEnd },
        'impact.target.baseline': { after: baseline },
        'impact.target.target': { after: target },
      },
    });
    return readTarget(db, id);
  }

  /** The target, locked, under a framework that still takes changes. */
  async function openTarget(db: ImpactDb, tx: Args<unknown>['tx'], targetId: string) {
    const found = await selectTargets(db)
      .where('t.id', '=', targetId)
      .forUpdate()
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();
    await checks.openFramework(tx, found.framework_id);
    return toTarget(found);
  }

  async function updateTarget({
    tx,
    context,
    input,
  }: Args<TargetParams & { body: TargetUpdate }>): Promise<Target> {
    const db = impactDb(tx);
    const { targetId } = input.params;
    const { baseline, target } = input.body;
    const found = await openTarget(db, tx, targetId);
    if (found.baseline === baseline && found.target === target) return found;

    const unit = await checks.indicatorUnit(tx, found.frameworkId, found.indicatorId);
    checks.checkFigures(unit, [baseline, target]);
    await db
      .updateTable('impact.target')
      .set({ baseline, target, updated_by: context.membership.id })
      .where('id', '=', targetId)
      .execute();
    await context.audit.record({
      action: 'impact.target.changed',
      entityId: targetId,
      changes: {
        ...(found.baseline === baseline
          ? {}
          : { 'impact.target.baseline': { before: found.baseline, after: baseline } }),
        ...(found.target === target
          ? {}
          : { 'impact.target.target': { before: found.target, after: target } }),
      },
    });
    return readTarget(db, targetId);
  }

  async function removeTarget({ tx, context, input }: Args<TargetParams>): Promise<undefined> {
    const db = impactDb(tx);
    const { targetId } = input.params;
    const found = await openTarget(db, tx, targetId);
    await db.deleteFrom('impact.target').where('id', '=', targetId).execute();
    await context.audit.record({
      action: 'impact.target.removed',
      entityId: targetId,
      changes: {
        'impact.target.indicator_id': { before: found.indicatorId },
        'impact.target.programme_id': { before: found.programmeId },
        'impact.target.period_start': { before: found.periodStart },
        'impact.target.period_end': { before: found.periodEnd },
        'impact.target.baseline': { before: found.baseline },
        'impact.target.target': { before: found.target },
      },
    });
    return undefined;
  }

  return { listTargets, getTarget, createTarget, updateTarget, removeTarget };
}
