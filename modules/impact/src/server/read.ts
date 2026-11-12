// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What several impact handlers read: a framework with its outcomes and
// indicators, and the checks a target, a result and a learning note share
// before they are written.

import {
  figureProblem,
  impactMessages,
  impactRefusals,
  type Framework,
  type FrameworkInput,
  type IndicatorAggregation,
  type IndicatorDirection,
  type IndicatorUnit,
  type ImpactMessage,
} from '../contracts/index.ts';
import { impactDb, iso, type ImpactDependencies, type Tx } from './context.ts';

export interface FrameworkRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly archived_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const frameworkColumns = [
  'id',
  'name',
  'description',
  'version',
  'archived_at',
  'created_at',
  'updated_at',
] as const;

/** The framework's own row, locked for the rest of the request when asked. */
export async function readFrameworkRow(
  tx: Tx,
  frameworkId: string,
  lock: 'update' | 'share' | null = null,
): Promise<FrameworkRow | undefined> {
  const query = impactDb(tx)
    .selectFrom('impact.framework')
    .select(frameworkColumns)
    .where('id', '=', frameworkId);
  if (lock === 'update') return query.forUpdate().executeTakeFirst();
  if (lock === 'share') return query.forShare().executeTakeFirst();
  return query.executeTakeFirst();
}

/** The framework's outcomes and indicators, each in the framework's order. */
export async function readItems(
  tx: Tx,
  frameworkId: string,
): Promise<Pick<FrameworkInput, 'outcomes' | 'indicators'>> {
  const db = impactDb(tx);
  const outcomes = await db
    .selectFrom('impact.outcome')
    .select(['id', 'name', 'description'])
    .where('framework_id', '=', frameworkId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const indicators = await db
    .selectFrom('impact.indicator')
    .select(['id', 'outcome_id', 'name', 'unit', 'direction', 'aggregation'])
    .where('framework_id', '=', frameworkId)
    .orderBy('position')
    .orderBy('id')
    .execute();
  return {
    outcomes: Object.fromEntries(
      outcomes.map(({ id, name, description }) => [id, { name, description }]),
    ),
    indicators: Object.fromEntries(
      indicators.map((indicator) => [
        indicator.id,
        {
          outcomeId: indicator.outcome_id,
          name: indicator.name,
          unit: indicator.unit as IndicatorUnit,
          direction: indicator.direction as IndicatorDirection,
          aggregation: indicator.aggregation as IndicatorAggregation,
        },
      ]),
    ),
  };
}

export async function toFramework(tx: Tx, row: FrameworkRow): Promise<Framework> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ...(await readItems(tx, row.id)),
    version: row.version,
    archivedAt: row.archived_at === null ? null : iso(row.archived_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** What a write under a framework checks first. */
export function writeChecks(deps: ImpactDependencies) {
  /** A problem with one field of the request's body. */
  const field = (name: string, message: ImpactMessage): Error =>
    deps.refuse(400, message, [{ field: `body.${name}`, message }]);

  /**
   * The framework, which the caller may change: there, and not archived. It
   * is locked against an archive until the request ends.
   */
  async function openFramework(tx: Tx, frameworkId: string): Promise<FrameworkRow> {
    const row = await readFrameworkRow(tx, frameworkId, 'share');
    if (row === undefined) throw deps.notFound();
    if (row.archived_at !== null) throw deps.refuse(409, impactRefusals.archived);
    return row;
  }

  /** The unit of the framework's indicator, locked against a change of unit. */
  async function indicatorUnit(
    tx: Tx,
    frameworkId: string,
    indicatorId: string,
  ): Promise<IndicatorUnit> {
    const indicator = await impactDb(tx)
      .selectFrom('impact.indicator')
      .select('unit')
      .where('framework_id', '=', frameworkId)
      .where('id', '=', indicatorId)
      .forShare()
      .executeTakeFirst();
    if (indicator === undefined) throw field('indicatorId', impactMessages.indicator);
    return indicator.unit as IndicatorUnit;
  }

  /** Refuses a figure that does not fit the unit; a null figure is none. */
  function checkFigures(unit: IndicatorUnit, figures: readonly (number | null)[]): void {
    for (const value of figures) {
      if (value !== null && figureProblem(unit, value) !== null) {
        throw deps.refuse(409, impactRefusals.valueForUnit);
      }
    }
  }

  async function checkProgramme(tx: Tx, programmeId: string | null): Promise<void> {
    if (programmeId !== null && !(await deps.programmeExists(tx, programmeId))) {
      throw field('programmeId', impactMessages.programme);
    }
  }

  return { field, openFramework, indicatorUnit, checkFigures, checkProgramme };
}

export type WriteChecks = ReturnType<typeof writeChecks>;
