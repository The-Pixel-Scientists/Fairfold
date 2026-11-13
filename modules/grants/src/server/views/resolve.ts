// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only way a stored view is used (E7, S12-49's export too). One member
// saves a view and another, with less access, runs it, so every use parses
// what is stored with today's schemas and then drops whatever this viewer may
// not see: owner and label terms and columns for anyone but staff, the
// organisation for a blind reviewer, and every answer column whose field the
// viewer's audience cannot see or whose classification is special category.
// What was dropped is named by id, never by value. A stored value that no
// longer parses is refused, not repaired.

import {
  canSee,
  classificationOf,
  questionsOf,
  type ProjectionAudience,
} from '@pixel-scientists/domain/forms';
import type { Permission } from '@pixel-scientists/domain/platform';

import {
  viewFilterSchema,
  viewInputSchema,
  viewSortSchema,
  type ViewColumn,
  type ViewFilter,
  type ViewSort,
} from '../../contracts/index.ts';
import { definitionOf } from '../forms/read.ts';
import type { Tx } from '../programme/tables.ts';
import { viewDb, type ViewRow } from './tables.ts';

export type ViewerAudience = Extract<ProjectionAudience, 'staff' | 'reviewer' | 'blind_reviewer'>;

/** Who runs the view: their audience, and what their roles give them. */
export interface Viewer {
  readonly audience: ViewerAudience;
  readonly permissions: ReadonlySet<Permission>;
}

export interface ResolvedView {
  readonly id: string;
  readonly name: string;
  readonly filter: ViewFilter;
  readonly sort: ViewSort;
  readonly columns: ViewColumn[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The ids of what was left out: a column id, `answer.<field id>`, `filter.<key>` or `sort.<key>`. */
  readonly dropped: string[];
}

export type Unusable = { readonly code: 'forbidden' | 'unusable' };

const DEFAULT_SORT: ViewSort = { by: 'submittedAt', direction: 'desc' };
const ANSWER = 'answer.';

export const columnKey = (column: ViewColumn): string =>
  column.kind === 'column' ? column.id : `${ANSWER}${column.fieldId}`;

const columnOf = (key: string): unknown =>
  key.startsWith(ANSWER)
    ? { kind: 'answer', fieldId: key.slice(ANSWER.length) }
    : { kind: 'column', id: key };

/** Triage data is for staff; a blind reviewer is also kept from the applicant's identity. */
const hidden: Record<ViewerAudience, ReadonlySet<string>> = {
  staff: new Set(),
  reviewer: new Set(['owner', 'labels']),
  blind_reviewer: new Set(['owner', 'labels', 'organisation']),
};

/** The viewer's own projection of a view already parsed; `answers` are the field ids they may see. */
export function restrictView(
  view: Pick<ResolvedView, 'filter' | 'sort' | 'columns'>,
  audience: ViewerAudience,
  answers: ReadonlySet<string>,
): Pick<ResolvedView, 'filter' | 'sort' | 'columns' | 'dropped'> {
  const dropped: string[] = [];
  const out = hidden[audience];
  const columns = view.columns.filter((column) => {
    const keep = column.kind === 'answer' ? answers.has(column.fieldId) : !out.has(column.id);
    if (!keep) dropped.push(columnKey(column));
    return keep;
  });
  const { ownerId, labelId, ...rest } = view.filter;
  const filter: ViewFilter = { ...rest };
  if (ownerId !== undefined) {
    if (out.has('owner')) dropped.push('filter.ownerId');
    else filter.ownerId = ownerId;
  }
  if (labelId !== undefined) {
    if (out.has('labels')) dropped.push('filter.labelId');
    else filter.labelId = labelId;
  }
  const sortOut = out.has(view.sort.by);
  if (sortOut) dropped.push(`sort.${view.sort.by}`);
  return {
    filter,
    sort: sortOut ? DEFAULT_SORT : view.sort,
    columns,
    dropped,
  };
}

/** The answer field ids this audience may see in every published version in the view's scope. */
async function visibleAnswers(
  tx: Tx,
  audience: ViewerAudience,
  filter: ViewFilter,
): Promise<ReadonlySet<string>> {
  let query = viewDb(tx)
    .selectFrom('grants.form_version as f')
    .innerJoin('grants.round as r', 'r.id', 'f.round_id')
    .select('f.definition')
    .where('f.status', '=', 'published');
  if (filter.roundId !== undefined) query = query.where('r.id', '=', filter.roundId);
  if (filter.programmeId !== undefined)
    query = query.where('r.programme_id', '=', filter.programmeId);
  const verdict = new Map<string, boolean>();
  for (const { definition } of await query.execute()) {
    const form = definitionOf(definition);
    for (const field of form === null ? [] : questionsOf(form)) {
      const allowed = canSee(field, audience) && classificationOf(field) !== 'special_category';
      verdict.set(field.id, (verdict.get(field.id) ?? true) && allowed);
    }
  }
  return new Set([...verdict].filter(([, allowed]) => allowed).map(([id]) => id));
}

/** The stored view as this viewer may use it, or the code that refuses it. */
export async function resolveView(
  tx: Tx,
  viewer: Viewer,
  row: ViewRow,
): Promise<ResolvedView | Unusable> {
  if (!viewer.permissions.has('grants.applications.read')) return { code: 'forbidden' };
  const filter = viewFilterSchema.safeParse(row.filter);
  const sort = viewSortSchema.safeParse(row.sort);
  const columns = viewInputSchema.shape.columns.safeParse(row.columns.map(columnOf));
  if (!filter.success || !sort.success || !columns.success) return { code: 'unusable' };

  const answers = columns.data.some((column) => column.kind === 'answer')
    ? await visibleAnswers(tx, viewer.audience, filter.data)
    : new Set<string>();
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...restrictView(
      { filter: filter.data, sort: sort.data, columns: columns.data },
      viewer.audience,
      answers,
    ),
  };
}

/** One view of the tenant by id, as `viewer` may use it; undefined where there is none. */
export async function resolveViewForViewer(
  tx: Tx,
  viewer: Viewer,
  viewId: string,
): Promise<ResolvedView | Unusable | undefined> {
  const row = await viewDb(tx)
    .selectFrom('grants.saved_view')
    .select(['id', 'name', 'filter', 'sort', 'columns', 'created_by', 'created_at', 'updated_at'])
    .where('id', '=', viewId)
    .executeTakeFirst();
  return row === undefined ? undefined : resolveView(tx, viewer, row);
}
