// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The framework routes' handlers. The platform has already checked the
// session, the permission and that impact is on. Every change to what a
// framework records writes its configuration version (rule 10) and its
// audit event in the request's transaction, and a save that changes nothing
// writes neither. The order of outcomes and indicators is how the framework
// is shown, not part of what it records: a save that only reorders them
// keeps the version.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  frameworkDiff,
  impactRefusals,
  type Framework,
  type FrameworkChange,
  type FrameworkInput,
  type FrameworkList,
} from '../contracts/index.ts';
import {
  impactDb,
  iso,
  isTaken,
  type Args,
  type FrameworkParams,
  type ImpactDb,
  type ImpactDependencies,
} from './context.ts';
import { readFrameworkRow, readItems, toFramework } from './read.ts';

const COLUMNS: Readonly<Record<string, string>> = {
  name: 'impact.framework.name',
  description: 'impact.framework.description',
  'outcomes.name': 'impact.outcome.name',
  'outcomes.description': 'impact.outcome.description',
  'indicators.outcome': 'impact.indicator.outcome_id',
  'indicators.name': 'impact.indicator.name',
  'indicators.unit': 'impact.indicator.unit',
  'indicators.direction': 'impact.indicator.direction',
  'indicators.aggregation': 'impact.indicator.aggregation',
};

/**
 * The columns a diff changed, for the audit event. The framework's name is
 * recorded with its values. The rest are named alone: the configuration
 * version holds each value, by outcome and indicator.
 */
export function auditChanges(diff: readonly FrameworkChange[]): AuditChanges {
  const changes: Record<string, { before?: unknown; after?: unknown }> = {};
  for (const { path, from, to } of diff) {
    const [first = '', , last = ''] = path.split('.');
    const column = COLUMNS[last === '' ? first : `${first}.${last}`];
    if (column === undefined) throw new Error(`The framework diff has no column for ${path}.`);
    changes[column] = path === 'name' ? { before: from, after: to } : {};
  }
  return changes;
}

type Items = Pick<FrameworkInput, 'outcomes' | 'indicators'>;

const sameOrder = (before: object, after: object): boolean =>
  Object.keys(before).join() === Object.keys(after).join();

export function frameworkHandlers(deps: ImpactDependencies) {
  /** Refuses with a 409 when the statement meets a name or an item id already taken. */
  async function unlessTaken<T>(detail: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, detail) : error;
    }
  }

  /** Writes the outcomes and indicators as given, over those the framework has. */
  async function writeItems(
    db: ImpactDb,
    frameworkId: string,
    before: Items,
    after: Items,
  ): Promise<void> {
    const outcomes = Object.entries(after.outcomes);
    const indicators = Object.entries(after.indicators);
    const newOutcomes = outcomes.flatMap(([id, outcome], position) =>
      Object.hasOwn(before.outcomes, id) ? [] : [{ id, position, ...outcome }],
    );
    const newIndicators = indicators.flatMap(([id, indicator], position) =>
      Object.hasOwn(before.indicators, id) ? [] : [{ id, position, ...indicator }],
    );

    await unlessTaken(impactRefusals.itemTaken, async () => {
      if (newOutcomes.length > 0) {
        await db
          .insertInto('impact.outcome')
          .values((eb) =>
            newOutcomes.map(({ id, position, name, description }) => ({
              tenant_id: eb.fn<string>('app.current_tenant_id', []),
              id,
              framework_id: frameworkId,
              name,
              description,
              position,
            })),
          )
          .execute();
      }
      for (const [position, [id, { name, description }]] of outcomes.entries()) {
        if (!Object.hasOwn(before.outcomes, id)) continue;
        await db
          .updateTable('impact.outcome')
          .set({ name, description, position })
          .where('framework_id', '=', frameworkId)
          .where('id', '=', id)
          .execute();
      }
      if (newIndicators.length > 0) {
        await db
          .insertInto('impact.indicator')
          .values((eb) =>
            newIndicators.map(({ id, position, outcomeId, ...indicator }) => ({
              tenant_id: eb.fn<string>('app.current_tenant_id', []),
              id,
              framework_id: frameworkId,
              outcome_id: outcomeId,
              ...indicator,
              position,
            })),
          )
          .execute();
      }
    });
    for (const [position, [id, { outcomeId, ...indicator }]] of indicators.entries()) {
      if (!Object.hasOwn(before.indicators, id)) continue;
      await db
        .updateTable('impact.indicator')
        .set({ outcome_id: outcomeId, ...indicator, position })
        .where('framework_id', '=', frameworkId)
        .where('id', '=', id)
        .execute();
    }
    const removed = (was: object, is: object) =>
      Object.keys(was).filter((id) => !Object.hasOwn(is, id));
    const goneIndicators = removed(before.indicators, after.indicators);
    if (goneIndicators.length > 0) {
      await db
        .deleteFrom('impact.indicator')
        .where('framework_id', '=', frameworkId)
        .where('id', 'in', goneIndicators)
        .execute();
    }
    const goneOutcomes = removed(before.outcomes, after.outcomes);
    if (goneOutcomes.length > 0) {
      await db
        .deleteFrom('impact.outcome')
        .where('framework_id', '=', frameworkId)
        .where('id', 'in', goneOutcomes)
        .execute();
    }
  }

  /** Refuses a change the rows under the framework do not allow, before anything is written. */
  async function checkInUse(db: ImpactDb, before: Items, after: Items): Promise<void> {
    const kept = Object.keys(before.indicators).filter((id) => Object.hasOwn(after.indicators, id));
    const gone = Object.keys(before.indicators).filter((id) => !kept.includes(id));
    const newUnit = kept.filter((id) => before.indicators[id]?.unit !== after.indicators[id]?.unit);
    const used = async (ids: readonly string[]): Promise<boolean> => {
      if (ids.length === 0) return false;
      const target = await db
        .selectFrom('impact.target')
        .select('id')
        .where('indicator_id', 'in', ids)
        .limit(1)
        .executeTakeFirst();
      const result = await db
        .selectFrom('impact.result')
        .select('id')
        .where('indicator_id', 'in', ids)
        .limit(1)
        .executeTakeFirst();
      return target !== undefined || result !== undefined;
    };
    if (await used(gone)) throw deps.refuse(409, impactRefusals.indicatorInUse);
    if (await used(newUnit)) throw deps.refuse(409, impactRefusals.unitFixed);

    const goneOutcomes = Object.keys(before.outcomes).filter(
      (id) => !Object.hasOwn(after.outcomes, id),
    );
    if (goneOutcomes.length > 0) {
      const note = await db
        .selectFrom('impact.learning_note')
        .select('id')
        .where('outcome_id', 'in', goneOutcomes)
        .limit(1)
        .executeTakeFirst();
      if (note !== undefined) throw deps.refuse(409, impactRefusals.outcomeInUse);
    }
  }

  async function listFrameworks({ tx }: Args<unknown>): Promise<FrameworkList> {
    const db = impactDb(tx);
    const frameworks = await db
      .selectFrom('impact.framework')
      .select(['id', 'name', 'description', 'version', 'archived_at', 'updated_at'])
      .orderBy((eb) => eb('archived_at', 'is not', null))
      .orderBy((eb) => eb.fn('lower', ['name']))
      .orderBy('id')
      .execute();
    const counts = async (table: 'impact.outcome' | 'impact.indicator') =>
      new Map(
        (
          await db
            .selectFrom(table)
            .select((eb) => ['framework_id', eb.fn.countAll<string>().as('count')])
            .groupBy('framework_id')
            .execute()
        ).map((row) => [row.framework_id, Number(row.count)]),
      );
    const [outcomes, indicators] = [
      await counts('impact.outcome'),
      await counts('impact.indicator'),
    ];
    return {
      frameworks: frameworks.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        outcomeCount: outcomes.get(row.id) ?? 0,
        indicatorCount: indicators.get(row.id) ?? 0,
        version: row.version,
        archivedAt: row.archived_at === null ? null : iso(row.archived_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  async function getFramework({ tx, input }: Args<FrameworkParams>): Promise<Framework> {
    const row = await readFrameworkRow(tx, input.params.frameworkId);
    if (row === undefined) throw deps.notFound();
    return toFramework(tx, row);
  }

  async function createFramework({
    tx,
    context,
    input,
  }: Args<{ body: FrameworkInput }>): Promise<Framework> {
    const db = impactDb(tx);
    const actor = context.membership.id;
    const { name, description } = input.body;
    const { id } = await unlessTaken(impactRefusals.nameTaken, () =>
      db
        .insertInto('impact.framework')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          name,
          description,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await writeItems(db, id, { outcomes: {}, indicators: {} }, input.body);

    const diff = frameworkDiff(null, input.body);
    await context.config.record('impact.framework', id, diff);
    await context.audit.record({
      action: 'impact.framework.created',
      entityId: id,
      changes: auditChanges(diff),
    });
    return getFramework({ tx, context, input: { params: { frameworkId: id } } });
  }

  async function updateFramework({
    tx,
    context,
    input,
  }: Args<FrameworkParams & { body: FrameworkInput }>): Promise<Framework> {
    const { frameworkId } = input.params;
    const db = impactDb(tx);
    const found = await readFrameworkRow(tx, frameworkId, 'update');
    if (found === undefined) throw deps.notFound();
    if (found.archived_at !== null) throw deps.refuse(409, impactRefusals.archived);

    const items = await readItems(tx, frameworkId);
    const before = { name: found.name, description: found.description, ...items };
    const diff = frameworkDiff(before, input.body);
    const reordered =
      !sameOrder(items.outcomes, input.body.outcomes) ||
      !sameOrder(items.indicators, input.body.indicators);
    if (diff.length === 0 && !reordered) return toFramework(tx, found);

    await checkInUse(db, items, input.body);
    await writeItems(db, frameworkId, items, input.body);
    if (diff.length > 0) {
      await unlessTaken(impactRefusals.nameTaken, () =>
        db
          .updateTable('impact.framework')
          .set((eb) => ({
            name: input.body.name,
            description: input.body.description,
            version: eb('version', '+', 1),
            updated_by: context.membership.id,
          }))
          .where('id', '=', frameworkId)
          .execute(),
      );
      await context.config.record('impact.framework', frameworkId, diff);
      await context.audit.record({
        action: 'impact.framework.changed',
        entityId: frameworkId,
        changes: auditChanges(diff),
      });
    }
    return getFramework({ tx, context, input: { params: { frameworkId } } });
  }

  async function archiveFramework({
    tx,
    context,
    input,
  }: Args<FrameworkParams>): Promise<Framework> {
    const { frameworkId } = input.params;
    const found = await readFrameworkRow(tx, frameworkId, 'update');
    if (found === undefined) throw deps.notFound();
    if (found.archived_at === null) {
      await impactDb(tx)
        .updateTable('impact.framework')
        // The database sets the time itself.
        .set({ archived_at: new Date(), updated_by: context.membership.id })
        .where('id', '=', frameworkId)
        .execute();
      await context.audit.record({ action: 'impact.framework.archived', entityId: frameworkId });
    }
    return getFramework({ tx, context, input: { params: { frameworkId } } });
  }

  return { listFrameworks, getFramework, createFramework, updateFramework, archiveFramework };
}
