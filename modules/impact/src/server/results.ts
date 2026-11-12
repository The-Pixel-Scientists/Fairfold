// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The result routes' handlers. A result's evidence is files a member has
// already uploaded through the platform's file routes: adding one links its
// file and removing one releases it, in the database (ADR 0030). The audit
// events hold the figure and name the other fields changed, never a note
// or a caption.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  impactMessages,
  impactRefusals,
  type Result,
  type ResultInput,
  type ResultPage,
  type ResultQuery,
  type ResultSource,
  type ResultUpdate,
} from '../contracts/index.ts';
import {
  figure,
  impactDb,
  iso,
  type Args,
  type ImpactDb,
  type ImpactDependencies,
  type Tx,
} from './context.ts';
import { readFrameworkRow, writeChecks } from './read.ts';

export interface ResultParams {
  readonly params: { readonly resultId: string };
}

type Evidence = ResultInput['evidence'];

export const PAGE_SIZE = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A page's last result: the end of its period and its id. */
export const encodeCursor = (periodEnd: string, id: string): string =>
  Buffer.from(`${periodEnd} ${id}`).toString('base64url');

export function decodeCursor(cursor: string): { periodEnd: string; id: string } | null {
  const [periodEnd = '', id = '', ...rest] = Buffer.from(cursor, 'base64url').toString().split(' ');
  return rest.length === 0 && DATE.test(periodEnd) && ID.test(id) ? { periodEnd, id } : null;
}

/** Results with their dates as text, so no time zone touches them. */
const selectResults = (db: ImpactDb) =>
  db
    .selectFrom('impact.result as r')
    .select((eb) => [
      'r.id',
      'r.framework_id',
      'r.indicator_id',
      'r.programme_id',
      eb.cast<string>('r.period_start', 'text').as('period_start'),
      eb.cast<string>('r.period_end', 'text').as('period_end'),
      'r.value',
      'r.note',
      'r.source',
      'r.created_at',
      'r.updated_at',
    ]);

type ResultRow = Awaited<ReturnType<ReturnType<typeof selectResults>['executeTakeFirstOrThrow']>>;

const toSummary = (row: ResultRow) => ({
  id: row.id,
  frameworkId: row.framework_id,
  indicatorId: row.indicator_id,
  programmeId: row.programme_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  value: figure(row.value),
  source: row.source as ResultSource,
  recordedAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const readEvidence = (db: ImpactDb, resultId: string): Promise<Evidence> =>
  db
    .selectFrom('impact.result_evidence')
    .select(['file_id as fileId', 'caption'])
    .where('result_id', '=', resultId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

export function resultHandlers(deps: ImpactDependencies) {
  const checks = writeChecks(deps);

  async function listResults({ tx, input }: Args<{ query: ResultQuery }>): Promise<ResultPage> {
    const db = impactDb(tx);
    const { frameworkId, indicatorId, programmeId, cursor } = input.query;
    if ((await readFrameworkRow(tx, frameworkId)) === undefined) throw deps.notFound();
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    if (after === null) throw deps.refuse(400, impactRefusals.page);

    let query = selectResults(db)
      .select((eb) =>
        eb
          .selectFrom('impact.result_evidence as e')
          .select((count) => count.fn.countAll<string>().as('count'))
          .whereRef('e.result_id', '=', 'r.id')
          .as('evidence_count'),
      )
      .where('r.framework_id', '=', frameworkId);
    if (indicatorId !== undefined) query = query.where('r.indicator_id', '=', indicatorId);
    if (programmeId !== undefined) query = query.where('r.programme_id', '=', programmeId);
    if (after !== undefined) {
      query = query.where((eb) =>
        eb.or([
          eb('r.period_end', '<', after.periodEnd),
          eb.and([eb('r.period_end', '=', after.periodEnd), eb('r.id', '<', after.id)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('r.period_end', 'desc')
      .orderBy('r.id', 'desc')
      .limit(PAGE_SIZE + 1)
      .execute();
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      results: page.map((row) => ({
        ...toSummary(row),
        evidenceCount: Number(row.evidence_count ?? 0),
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last !== undefined
          ? encodeCursor(last.period_end, last.id)
          : null,
    };
  }

  async function getResult({ tx, input }: Args<ResultParams>): Promise<Result> {
    const db = impactDb(tx);
    const row = await selectResults(db)
      .where('r.id', '=', input.params.resultId)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return { ...toSummary(row), note: row.note, evidence: await readEvidence(db, row.id) };
  }

  /**
   * Refuses, naming each, the files that are not ready to link: missing,
   * not yet clean, erased, or already linked to something.
   */
  async function checkFiles(db: ImpactDb, evidence: Evidence, added: readonly string[]) {
    if (added.length === 0) return;
    const ready = new Set(
      (
        await db
          .selectFrom('app.file')
          .select('id')
          .where('id', 'in', added)
          .where('scan_state', '=', 'clean')
          .where('linked_at', 'is', null)
          .where('erased_at', 'is', null)
          .forUpdate()
          .execute()
      ).map((file) => file.id),
    );
    const message = impactMessages.evidenceFile;
    const errors = evidence.flatMap(({ fileId }, index) =>
      added.includes(fileId) && !ready.has(fileId)
        ? [{ field: `body.evidence.${String(index)}.fileId`, message }]
        : [],
    );
    if (errors.length > 0) throw deps.refuse(400, message, errors);
  }

  const addEvidence = async (
    db: ImpactDb,
    frameworkId: string,
    resultId: string,
    actor: string,
    evidence: Evidence,
  ): Promise<void> => {
    if (evidence.length === 0) return;
    await db
      .insertInto('impact.result_evidence')
      .values((eb) =>
        evidence.map(({ fileId, caption }) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          framework_id: frameworkId,
          result_id: resultId,
          file_id: fileId,
          caption,
          added_by: actor,
        })),
      )
      .execute();
  };

  async function createResult({
    tx,
    context,
    input,
  }: Args<{ body: ResultInput }>): Promise<Result> {
    const db = impactDb(tx);
    const actor = context.membership.id;
    const { frameworkId, indicatorId, programmeId, periodStart, periodEnd, value, note, evidence } =
      input.body;
    await checks.openFramework(tx, frameworkId);
    const unit = await checks.indicatorUnit(tx, frameworkId, indicatorId);
    checks.checkFigures(unit, [value]);
    await checks.checkProgramme(tx, programmeId);
    await checkFiles(
      db,
      evidence,
      evidence.map(({ fileId }) => fileId),
    );

    const { id } = await db
      .insertInto('impact.result')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        framework_id: frameworkId,
        indicator_id: indicatorId,
        programme_id: programmeId,
        period_start: periodStart,
        period_end: periodEnd,
        value,
        note,
        recorded_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await addEvidence(db, frameworkId, id, actor, evidence);
    await context.audit.record({
      action: 'impact.result.recorded',
      entityId: id,
      changes: {
        'impact.result.indicator_id': { after: indicatorId },
        'impact.result.programme_id': { after: programmeId },
        'impact.result.period_start': { after: periodStart },
        'impact.result.period_end': { after: periodEnd },
        'impact.result.value': { after: value },
      },
    });
    return getResult({ tx, context, input: { params: { resultId: id } } });
  }

  /** The result, locked, under a framework that still takes changes. */
  async function openResult(db: ImpactDb, tx: Tx, resultId: string) {
    const found = await selectResults(db)
      .where('r.id', '=', resultId)
      .forUpdate()
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();
    await checks.openFramework(tx, found.framework_id);
    return found;
  }

  async function updateResult({
    tx,
    context,
    input,
  }: Args<ResultParams & { body: ResultUpdate }>): Promise<Result> {
    const db = impactDb(tx);
    const actor = context.membership.id;
    const { resultId } = input.params;
    const { value, note, evidence } = input.body;
    const found = await openResult(db, tx, resultId);
    const before = await readEvidence(db, resultId);

    const caption = new Map(before.map((item) => [item.fileId, item.caption]));
    const kept = new Set(evidence.map(({ fileId }) => fileId));
    const added = evidence.filter(({ fileId }) => !caption.has(fileId));
    const removed = before.filter(({ fileId }) => !kept.has(fileId));
    const recaptioned = evidence.filter(
      (item) => caption.has(item.fileId) && caption.get(item.fileId) !== item.caption,
    );
    const changes: Record<string, AuditChanges[string]> = {
      ...(figure(found.value) === value
        ? {}
        : { 'impact.result.value': { before: figure(found.value), after: value } }),
      ...(found.note === note ? {} : { 'impact.result.note': {} }),
      ...(added.length + removed.length === 0 ? {} : { 'impact.result_evidence.file_id': {} }),
      ...(recaptioned.length === 0 ? {} : { 'impact.result_evidence.caption': {} }),
    };
    if (Object.keys(changes).length === 0) {
      return getResult({ tx, context, input: { params: { resultId } } });
    }

    const unit = await checks.indicatorUnit(tx, found.framework_id, found.indicator_id);
    checks.checkFigures(unit, [value]);
    await checkFiles(
      db,
      evidence,
      added.map(({ fileId }) => fileId),
    );
    await db
      .updateTable('impact.result')
      .set({ value, note, updated_by: actor })
      .where('id', '=', resultId)
      .execute();
    if (removed.length > 0) {
      await db
        .deleteFrom('impact.result_evidence')
        .where('result_id', '=', resultId)
        .where(
          'file_id',
          'in',
          removed.map(({ fileId }) => fileId),
        )
        .execute();
    }
    for (const item of recaptioned) {
      await db
        .updateTable('impact.result_evidence')
        .set({ caption: item.caption })
        .where('result_id', '=', resultId)
        .where('file_id', '=', item.fileId)
        .execute();
    }
    await addEvidence(db, found.framework_id, resultId, actor, added);
    await context.audit.record({ action: 'impact.result.corrected', entityId: resultId, changes });
    return getResult({ tx, context, input: { params: { resultId } } });
  }

  async function removeResult({ tx, context, input }: Args<ResultParams>): Promise<undefined> {
    const db = impactDb(tx);
    const { resultId } = input.params;
    const found = await openResult(db, tx, resultId);
    await db.deleteFrom('impact.result_evidence').where('result_id', '=', resultId).execute();
    await db.deleteFrom('impact.result').where('id', '=', resultId).execute();
    await context.audit.record({
      action: 'impact.result.removed',
      entityId: resultId,
      changes: {
        'impact.result.indicator_id': { before: found.indicator_id },
        'impact.result.programme_id': { before: found.programme_id },
        'impact.result.period_start': { before: found.period_start },
        'impact.result.period_end': { before: found.period_end },
        'impact.result.value': { before: figure(found.value) },
      },
    });
    return undefined;
  }

  return { listResults, getResult, createResult, updateResult, removeResult };
}
