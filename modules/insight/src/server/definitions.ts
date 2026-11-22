// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The report definition handlers. The platform has already checked the
// session, the permission and that insight is on. Each change to what a
// definition records writes its configuration version (rule 10) and its audit
// event in the request's transaction, and a save that changes nothing writes
// neither. The events hold ids, versions and the report's name; the rest of a
// definition is recorded by its column alone, since its filters are staff's words.

import type { AuditChanges } from '@pixel-scientists/db';
import type { JsonObject } from '@pixel-scientists/db/generated/insight';

import {
  insightRefusals,
  reportDefinitionDiff,
  type ReportDefinition,
  type ReportDefinitionChange,
  type ReportDefinitionInput,
  type ReportDefinitionList,
} from '../contracts/index.ts';
import {
  insightDb,
  isTaken,
  iso,
  type Args,
  type InsightDependencies,
  type ReportParams as Params,
  type Tx,
} from './context.ts';
import { serverRefusals } from './messages.ts';

const columns = [
  'id',
  'kind',
  'name',
  'definition',
  'version',
  'archived_at',
  'created_at',
  'updated_at',
] as const;

/** The definition's own row, locked for the rest of the request when asked. */
export function readDefinitionRow(tx: Tx, reportId: string, lock = false) {
  const query = insightDb(tx)
    .selectFrom('insight.report_definition')
    .select(columns)
    .where('id', '=', reportId);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

type Row = NonNullable<Awaited<ReturnType<typeof readDefinitionRow>>>;

/** What the definition column holds: the input without its kind and name. */
function stored(input: ReportDefinitionInput): JsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'kind' && key !== 'name'),
  );
}

/** The input a row was made from. */
export const inputOf = (row: Row): ReportDefinitionInput =>
  ({ ...(row.definition as object), kind: row.kind, name: row.name }) as ReportDefinitionInput;

const toDefinition = (row: Row): ReportDefinition => ({
  ...inputOf(row),
  id: row.id,
  version: row.version,
  archivedAt: row.archived_at === null ? null : iso(row.archived_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

type Filters = Readonly<Record<string, { field: string; operator: string; value: unknown }>>;

/**
 * The diff from one version to the next. A filter's value is never in it, so
 * a filter whose value alone moved is named by its field, unchanged.
 */
function diffOf(
  before: ReportDefinitionInput | null,
  after: ReportDefinitionInput,
): ReportDefinitionChange[] {
  const diff = reportDefinitionDiff(before, after);
  const was: Filters = before?.filters ?? {};
  for (const [id, filter] of Object.entries(after.filters as Filters)) {
    const old = Object.hasOwn(was, id) ? was[id] : undefined;
    if (old !== undefined && old.value !== filter.value) {
      diff.push({ path: `filters.${id}.field`, from: filter.field, to: filter.field });
    }
  }
  return diff;
}

function auditChanges(
  diff: readonly ReportDefinitionChange[],
  version: { before: number | null; after: number },
): AuditChanges {
  const changes: Record<string, { before?: unknown; after?: unknown }> = {
    'insight.report_definition.version': { before: version.before, after: version.after },
  };
  for (const { path, from, to } of diff) {
    changes['insight.report_definition.definition'] = {};
    if (path === 'name') changes['insight.report_definition.name'] = { before: from, after: to };
  }
  return changes;
}

export function definitionHandlers(deps: InsightDependencies) {
  async function listReportDefinitions({ tx }: Args<unknown>): Promise<ReportDefinitionList> {
    const rows = await insightDb(tx)
      .selectFrom('insight.report_definition')
      .select(columns)
      .orderBy((eb) => eb('archived_at', 'is not', null))
      .orderBy((eb) => eb.fn('lower', ['name']))
      .orderBy('id')
      .execute();
    return {
      reports: rows.map((row) => ({
        id: row.id,
        kind: row.kind as ReportDefinitionInput['kind'],
        name: row.name,
        description: (row.definition as { description: string | null }).description,
        version: row.version,
        archivedAt: row.archived_at === null ? null : iso(row.archived_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  async function getReportDefinition({ tx, input }: Args<Params>): Promise<ReportDefinition> {
    const row = await readDefinitionRow(tx, input.params.reportId);
    if (row === undefined) throw deps.notFound();
    return toDefinition(row);
  }

  async function createReportDefinition({
    tx,
    context,
    input,
  }: Args<{ body: ReportDefinitionInput }>): Promise<ReportDefinition> {
    const actor = context.membership.id;
    const { kind, name } = input.body;
    let id: string;
    try {
      ({ id } = await insightDb(tx)
        .insertInto('insight.report_definition')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          kind,
          name,
          definition: stored(input.body),
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, serverRefusals.nameTaken) : error;
    }
    const diff = diffOf(null, input.body);
    await context.config.record('insight.report_definition', id, diff);
    await context.audit.record({
      action: 'insight.report_definition.created',
      entityId: id,
      changes: auditChanges(diff, { before: null, after: 1 }),
    });
    return getReportDefinition({ tx, context, input: { params: { reportId: id } } });
  }

  async function updateReportDefinition({
    tx,
    context,
    input,
  }: Args<Params & { body: ReportDefinitionInput }>): Promise<ReportDefinition> {
    const { reportId } = input.params;
    const found = await readDefinitionRow(tx, reportId, true);
    if (found === undefined) throw deps.notFound();
    if (found.archived_at !== null) throw deps.refuse(409, insightRefusals.archived);
    if (input.body.kind !== found.kind) throw deps.refuse(409, insightRefusals.kindFixed);

    const before = inputOf(found);
    const diff = diffOf(before, input.body);
    if (diff.length === 0) return toDefinition(found);

    try {
      await insightDb(tx)
        .updateTable('insight.report_definition')
        .set({
          name: input.body.name,
          definition: stored(input.body),
          version: found.version + 1,
          updated_by: context.membership.id,
        })
        .where('id', '=', reportId)
        .execute();
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, serverRefusals.nameTaken) : error;
    }
    await context.config.record('insight.report_definition', reportId, diff);
    await context.audit.record({
      action: 'insight.report_definition.changed',
      entityId: reportId,
      changes: auditChanges(diff, { before: found.version, after: found.version + 1 }),
    });
    return getReportDefinition({ tx, context, input: { params: { reportId } } });
  }

  async function archiveReportDefinition({
    tx,
    context,
    input,
  }: Args<Params>): Promise<ReportDefinition> {
    const { reportId } = input.params;
    const found = await readDefinitionRow(tx, reportId, true);
    if (found === undefined) throw deps.notFound();
    if (found.archived_at === null) {
      await insightDb(tx)
        .updateTable('insight.report_definition')
        // The database sets the time itself.
        .set({ archived_at: new Date(), updated_by: context.membership.id })
        .where('id', '=', reportId)
        .execute();
      await context.audit.record({
        action: 'insight.report_definition.archived',
        entityId: reportId,
      });
    }
    return getReportDefinition({ tx, context, input: { params: { reportId } } });
  }

  return {
    listReportDefinitions,
    getReportDefinition,
    createReportDefinition,
    updateReportDefinition,
    archiveReportDefinition,
  };
}
