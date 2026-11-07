// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Report definitions: versioned configuration (rule 10) in
// `insight.report_definition`. Each change records an
// `insight.report_definition` config version whose diff lists each changed
// value by path: `name`, `description`, `source`, `measures.<id>`,
// `groupBy.<id>`, and `filters.<id>.field` or `.operator`. A filter's value
// is never in a diff. A report's kind is fixed when it is made.
//
// - A warehouse report reads one table of the warehouse model, whose columns
//   are public or internal by their data contract, and counts or adds up
//   its rows, grouped and filtered by its columns.
// - An equality monitoring report counts one question's answers (its
//   source), broken down by at most one dimension and filtered by at most
//   one equality, each from a fixed list (ADR 0032).

import { idSchema } from '@pixel-scientists/domain';
import { warehouseTableNames, warehouseTables } from '@pixel-scientists/domain/warehouse';
import { z } from 'zod';

import { insightMessages, says } from './messages.ts';
import {
  monitoringBreakdowns,
  monitoringCodeSchema,
  monitoringFilterSchema,
} from './monitoring.ts';

export const reportKinds = ['warehouse', 'monitoring'] as const;

export type ReportKind = (typeof reportKinds)[number];

export const reportOperators = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'is_null',
  'not_null',
] as const;

/** A measure: `count`, or a function then a column, such as `sum.amount_minor`. */
const MEASURE = /^(?:count|(?:sum|min|max|average)\.[a-z][a-z0-9_]{0,62})$/;
const COLUMN = /^[a-z][a-z0-9_]{0,62}$/;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** An item's id: a uuid in lower case, as config diff paths take it. */
const itemIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const fields = {
  name: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !HIDDEN.test(value), says(insightMessages.hiddenCharacters))
    .refine((value) => value !== '', says(insightMessages.reportName)),
  description: z.string().trim().max(2000).nullable(),
};

const size = (max: number) => (record: object) => Object.keys(record).length <= max;

const warehouseShape = {
  kind: z.literal('warehouse'),
  ...fields,
  source: z.enum(warehouseTableNames),
  measures: z.record(itemIdSchema, z.string().regex(MEASURE)),
  groupBy: z.record(itemIdSchema, z.string().regex(COLUMN)),
  filters: z.record(
    itemIdSchema,
    z.strictObject({
      field: z.string().regex(COLUMN),
      operator: z.enum(reportOperators),
      value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
    }),
  ),
};

const monitoringShape = {
  kind: z.literal('monitoring'),
  ...fields,
  source: monitoringCodeSchema,
  groupBy: z
    .record(itemIdSchema, z.enum(monitoringBreakdowns))
    .refine(size(1), says(insightMessages.oneBreakdown)),
  filters: z
    .record(itemIdSchema, monitoringFilterSchema)
    .refine(size(1), says(insightMessages.oneFilter)),
};

const warehouseInputSchema = z
  .strictObject({
    ...warehouseShape,
    measures: warehouseShape.measures.refine(
      (measures) => Object.keys(measures).length >= 1 && size(10)(measures),
      says(insightMessages.measures),
    ),
    groupBy: warehouseShape.groupBy.refine(size(3), says(insightMessages.groupBy)),
    filters: warehouseShape.filters.refine(size(10), says(insightMessages.filters)),
  })
  .refine(({ source, measures, groupBy, filters }) => {
    const columns: Readonly<Record<string, unknown>> = warehouseTables[source].columns;
    return [
      ...Object.values(measures).map((measure) => measure.split('.')[1]),
      ...Object.values(groupBy),
      ...Object.values(filters).map(({ field }) => field),
    ].every((column) => column === undefined || Object.hasOwn(columns, column));
  }, says(insightMessages.columns));

/** Making or changing a report. The kind of an existing report cannot change. */
export const reportDefinitionInputSchema = z.discriminatedUnion('kind', [
  warehouseInputSchema,
  z.strictObject(monitoringShape),
]);

export type ReportDefinitionInput = z.infer<typeof reportDefinitionInputSchema>;

const metadata = {
  id: idSchema,
  version: z.int().min(1),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const reportDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({ ...warehouseShape, ...metadata }),
  z.object({ ...monitoringShape, ...metadata }),
]);

export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

/** By name, archived reports last. */
export const reportDefinitionListSchema = z.object({
  reports: z.array(
    z.object({
      id: idSchema,
      kind: z.enum(reportKinds),
      name: z.string(),
      description: z.string().nullable(),
      version: z.int().min(1),
      archivedAt: z.iso.datetime().nullable(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});

export type ReportDefinitionList = z.infer<typeof reportDefinitionListSchema>;

/** One changed value, as the `insight.report_definition` config diff schema records it. */
export interface ReportDefinitionChange {
  readonly path: string;
  readonly from: string | null;
  readonly to: string | null;
}

function paths(definition: ReportDefinitionInput | null): Map<string, string | null> {
  const values = new Map<string, string | null>();
  if (definition === null) return values;
  values.set('name', definition.name).set('description', definition.description);
  values.set('source', definition.source);
  const measures = definition.kind === 'warehouse' ? definition.measures : {};
  for (const [id, measure] of Object.entries(measures)) values.set(`measures.${id}`, measure);
  for (const [id, column] of Object.entries(definition.groupBy))
    values.set(`groupBy.${id}`, column);
  for (const [id, { field, operator }] of Object.entries(definition.filters)) {
    values.set(`filters.${id}.field`, field).set(`filters.${id}.operator`, operator);
  }
  return values;
}

/**
 * The changes from one version of a report to the next, `before` being null
 * for a new one; empty when nothing recorded changed.
 */
export function reportDefinitionDiff(
  before: ReportDefinitionInput | null,
  after: ReportDefinitionInput,
): ReportDefinitionChange[] {
  const from = paths(before);
  const to = paths(after);
  const changes = [...new Set([...from.keys(), ...to.keys()])]
    .map((path) => ({ path, from: from.get(path) ?? null, to: to.get(path) ?? null }))
    .filter((change) => change.from !== change.to);
  return changes;
}
