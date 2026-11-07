// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Segments: saved filters whose members are worked out when read. A segment
// is configuration (rule 10): each change records a `crm.segment` config
// version whose diff lists `name`, `description`, and
// `filters.<id>.field` and `.operator` (segmentDiff). A filter's value is
// never in a diff or an audit value. A party is a member when every filter
// matches. Archiving writes `crm.segment.archived`; the `crm.segment` diff
// schema has no path for it yet, so it writes no config version.
//
// Filters use a closed list of fields, each from the console's projection
// of records staff may read, none personal or special category, and none
// hidden from staff. Adding one is a contract change with its own review.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  identifierSchemeSchema,
  legalFormSchema,
  partyKindSchema,
} from '@pixel-scientists/party/contracts';
import { z } from 'zod';

import { crmMessages, says } from './messages.ts';
import { interactionKinds } from './records.ts';
import {
  choice,
  cursorSchema,
  dateSchema,
  line,
  pageQuerySchema,
  paragraphs,
  timestampSchema,
} from './schemas.ts';
import { partyStatuses } from './search.ts';

export const segmentOperators = [
  'eq',
  'ne',
  'has',
  'lacks',
  'has_verified',
  'before',
  'after',
] as const;

export type SegmentOperator = (typeof segmentOperators)[number];

/** Each field, the comparisons it takes and the value it compares with. */
export const segmentFields = {
  kind: { operators: ['eq'], value: partyKindSchema, sensitivity: 'internal' },
  status: { operators: ['eq', 'ne'], value: z.enum(partyStatuses), sensitivity: 'internal' },
  legal_form: { operators: ['eq', 'ne'], value: legalFormSchema, sensitivity: 'internal' },
  identifier_scheme: {
    operators: ['has', 'lacks', 'has_verified'],
    value: identifierSchemeSchema,
    sensitivity: 'internal',
  },
  /** On the list (`eq`) or not (`ne`). */
  list: { operators: ['eq', 'ne'], value: idSchema, sensitivity: 'internal' },
  /** People who are a current contact for the organisation. */
  contact_for: { operators: ['eq'], value: idSchema, sensitivity: 'internal' },
  interaction_kind: {
    operators: ['has', 'lacks'],
    value: z.enum(interactionKinds),
    sensitivity: 'internal',
  },
  last_interaction: { operators: ['before', 'after'], value: dateSchema, sensitivity: 'internal' },
  created: { operators: ['before', 'after'], value: dateSchema, sensitivity: 'internal' },
} as const satisfies Record<
  string,
  {
    readonly operators: readonly SegmentOperator[];
    readonly value: z.ZodType<string, string>;
    /** The classification map's level; segments.test.ts keeps it public or internal. */
    readonly sensitivity: string;
  }
>;

export type SegmentField = keyof typeof segmentFields;

export const segmentFieldIds = Object.keys(segmentFields) as [SegmentField, ...SegmentField[]];

export const MAX_SEGMENT_FILTERS = 10;

/** A filter's id: a uuid in lower case, as config diff paths take it. */
const filterIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const segmentFilterSchema = z
  .strictObject({
    field: choice(segmentFieldIds, crmMessages.segmentField),
    operator: choice(segmentOperators, crmMessages.segmentOperator),
    value: z.string().max(100),
  })
  .refine(
    ({ field, operator }) =>
      (segmentFields[field].operators as readonly SegmentOperator[]).includes(operator),
    { ...says(crmMessages.segmentOperator), path: ['operator'] },
  )
  .refine(({ field, value }) => segmentFields[field].value.safeParse(value).success, {
    ...says(crmMessages.segmentValue),
    path: ['value'],
  });

export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

const size = (record: object) =>
  Object.keys(record).length >= 1 && Object.keys(record).length <= MAX_SEGMENT_FILTERS;

export const segmentInputSchema = z.strictObject({
  name: line(200, crmMessages.segmentName),
  description: paragraphs(2000).optional(),
  filters: z
    .record(filterIdSchema, segmentFilterSchema)
    .refine(size, says(crmMessages.segmentFilters)),
});

export type SegmentInput = z.input<typeof segmentInputSchema>;

export const segmentSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  filters: z.record(
    filterIdSchema,
    z.strictObject({
      field: z.enum(segmentFieldIds),
      operator: z.enum(segmentOperators),
      value: z.string(),
    }),
  ),
  version: z.int().min(1),
  archivedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});

export type Segment = z.infer<typeof segmentSchema>;

const summarySchema = segmentSchema.omit({ filters: true });

/** By name, archived segments last. */
export const segmentPageSchema = z.strictObject({
  segments: z.array(summarySchema),
  nextCursor: cursorSchema.nullable(),
});

/** Party ids and kinds only, by party id. */
export const segmentMemberPageSchema = z.strictObject({
  members: z.array(z.strictObject({ partyId: idSchema, kind: partyKindSchema })),
  nextCursor: cursorSchema.nullable(),
});

/** One change, as the `crm.segment` config diff schema records it. */
export interface SegmentChange {
  readonly path: string;
  readonly from: string | null;
  readonly to: string | null;
}

type SegmentVersion = z.output<typeof segmentInputSchema>;

function paths(segment: SegmentVersion | null): Map<string, string | null> {
  const values = new Map<string, string | null>();
  if (segment === null) return values;
  values.set('name', segment.name).set('description', segment.description || null);
  for (const [id, { field, operator }] of Object.entries(segment.filters)) {
    values.set(`filters.${id}.field`, field).set(`filters.${id}.operator`, operator);
  }
  return values;
}

/** The paths of each filter in both versions whose field, operator or value changed. */
function changedFilters(before: SegmentVersion | null, after: SegmentVersion): Set<string> {
  const changed = new Set<string>();
  for (const [id, filter] of Object.entries(after.filters)) {
    const old = before?.filters[id];
    if (old === undefined) continue;
    if (
      old.field !== filter.field ||
      old.operator !== filter.operator ||
      old.value !== filter.value
    ) {
      changed.add(`filters.${id}.field`).add(`filters.${id}.operator`);
    }
  }
  return changed;
}

/**
 * The changes from one version of a segment to the next, `before` being
 * null for a new one. A filter whose value alone changed is listed by its
 * field and operator, each with `from` equal to `to`, so the version records
 * that the filter changed but not what it matches. An empty list means
 * nothing changed, and the server writes no version.
 */
export function segmentDiff(before: SegmentVersion | null, after: SegmentVersion): SegmentChange[] {
  const from = paths(before);
  const to = paths(after);
  const touched = changedFilters(before, after);
  return [...new Set([...from.keys(), ...to.keys()])]
    .map((path) => ({ path, from: from.get(path) ?? null, to: to.get(path) ?? null }))
    .filter((change) => change.from !== change.to || touched.has(change.path));
}

const manage = {
  audience: 'console',
  module: 'crm',
  permission: 'crm.segments.manage',
  scope: 'tenant',
} as const;

const read = { ...manage, permission: 'crm.records.read' } as const;

const segment = { params: z.strictObject({ segmentId: idSchema }) } as const;

export const listSegments = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/crm/segments',
  summary: 'List segments by name, archived segments last',
  query: pageQuerySchema,
  responses: { 200: segmentPageSchema },
});

export const getSegment = defineRoute({
  ...read,
  ...segment,
  method: 'GET',
  path: '/console/crm/segments/:segmentId',
  summary: 'Read a segment with its filters',
  responses: { 200: segmentSchema },
});

export const createSegment = defineRoute({
  ...manage,
  method: 'POST',
  idempotent: true,
  path: '/console/crm/segments',
  summary: 'Save a new segment',
  body: segmentInputSchema,
  responses: { 201: segmentSchema },
});

export const updateSegment = defineRoute({
  ...manage,
  ...segment,
  method: 'PUT',
  path: '/console/crm/segments/:segmentId',
  summary: "Change a segment's name, description or filters, as a new version",
  body: segmentInputSchema,
  responses: { 200: segmentSchema },
});

export const archiveSegment = defineRoute({
  ...manage,
  ...segment,
  method: 'POST',
  path: '/console/crm/segments/:segmentId/archive',
  summary: 'Archive a segment',
  responses: { 200: segmentSchema },
});

export const segmentMembers = defineRoute({
  ...read,
  ...segment,
  method: 'GET',
  path: '/console/crm/segments/:segmentId/members',
  summary: "Read a segment's current members",
  query: pageQuerySchema,
  responses: { 200: segmentMemberPageSchema },
});

export const segmentRoutes = {
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  archiveSegment,
  segmentMembers,
} as const;
