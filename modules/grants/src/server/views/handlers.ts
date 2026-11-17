// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The saved view routes' handlers (E7), matched with their contracts in
// apps/api/src/modules.ts. Only the filter, sort and column keys are stored,
// as the strict schemas parsed them; every read goes through resolveView().
// The creator is the session's member. A view's audit events name the
// changed field paths and never the name or a filter value.

import type { AuditChanges } from '@pixel-scientists/db';

import type { SavedView, SavedViewList, ViewInput } from '../../contracts/index.ts';
import { namesOf } from '../assessment/names.ts';
import type { Tx } from '../programme/tables.ts';
import type { TriageArgs } from '../triage/context.ts';
import type { ViewContext, ViewDependencies } from './context.ts';
import {
  columnKey,
  resolveView,
  resolveViewForViewer,
  type ResolvedView,
  type Viewer,
} from './resolve.ts';
import { viewDb } from './tables.ts';

const UNUSABLE = 'This view can no longer be used. Ask the member who saved it to save it again.';
const FIELDS = ['name', 'filter', 'sort', 'columns'] as const;

type Args<I> = Omit<TriageArgs<I>, 'context'> & { readonly context: ViewContext };

const viewerOf = (context: ViewContext): Viewer => ({
  audience: 'staff',
  permissions: context.membership.permissions,
});

const paths = (fields: readonly (typeof FIELDS)[number][]): AuditChanges =>
  Object.fromEntries(fields.map((field) => [`grants.saved_view.${field}`, {}]));

export function viewHandlers(deps: ViewDependencies) {
  const columns = [
    'id',
    'name',
    'filter',
    'sort',
    'columns',
    'created_by',
    'created_at',
    'updated_at',
  ] as const;

  const present = (view: ResolvedView, names: ReadonlyMap<string, string | null>): SavedView => ({
    id: view.id,
    name: view.name,
    filter: view.filter,
    sort: view.sort,
    columns: view.columns,
    createdBy: { membershipId: view.createdBy, name: names.get(view.createdBy) ?? null },
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  });

  async function read(tx: Tx, context: ViewContext, id: string): Promise<SavedView> {
    const view = await resolveViewForViewer(tx, viewerOf(context), id);
    if (view === undefined) throw deps.notFound();
    if ('code' in view) throw deps.refuse(409, UNUSABLE);
    return present(view, await namesOf(tx, [view.createdBy]));
  }

  async function listSavedViews({ tx, context }: Args<object>): Promise<SavedViewList> {
    const rows = await viewDb(tx)
      .selectFrom('grants.saved_view')
      .select(columns)
      .orderBy((eb) => eb.fn('lower', ['name']))
      .orderBy('id')
      .execute();
    const viewer = viewerOf(context);
    const views = (await Promise.all(rows.map((row) => resolveView(tx, viewer, row)))).filter(
      (view): view is ResolvedView => !('code' in view),
    );
    const names = await namesOf(
      tx,
      views.map((view) => view.createdBy),
    );
    return { views: views.map((view) => present(view, names)) };
  }

  const getSavedView = ({ tx, context, input }: Args<{ params: { viewId: string } }>) =>
    read(tx, context, input.params.viewId);

  async function createSavedView({
    tx,
    context,
    input,
  }: Args<{ body: ViewInput }>): Promise<SavedView> {
    const { name, filter, sort, columns: shown } = input.body;
    const me = context.membership.id;
    const { id } = await viewDb(tx)
      .insertInto('grants.saved_view')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        name,
        filter: JSON.stringify(filter),
        sort: JSON.stringify(sort),
        columns: shown.map(columnKey),
        created_by: me,
        updated_by: me,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'grants.saved_view.created',
      entityId: id,
      changes: paths(FIELDS),
    });
    return read(tx, context, id);
  }

  async function updateSavedView({
    tx,
    context,
    input,
  }: Args<{ params: { viewId: string }; body: ViewInput }>): Promise<SavedView> {
    const { viewId } = input.params;
    const { name, filter, sort, columns: shown } = input.body;
    const db = viewDb(tx);
    const stored = shown.map(columnKey);
    const row = await db
      .selectFrom('grants.saved_view')
      .select((eb) => [
        'created_by',
        eb('name', '=', name).as('name'),
        eb('filter', '=', eb.cast(eb.val(JSON.stringify(filter)), 'jsonb')).as('filter'),
        eb('sort', '=', eb.cast(eb.val(JSON.stringify(sort)), 'jsonb')).as('sort'),
        eb('columns', '=', eb.val(stored)).as('columns'),
      ])
      .where('id', '=', viewId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    if (row.created_by !== context.membership.id) throw deps.forbidden();

    const changed = FIELDS.filter((field) => !row[field]);
    if (changed.length > 0) {
      await db
        .updateTable('grants.saved_view')
        .set({
          name,
          filter: JSON.stringify(filter),
          sort: JSON.stringify(sort),
          columns: stored,
          updated_by: context.membership.id,
        })
        .where('id', '=', viewId)
        .execute();
      await context.audit.record({
        action: 'grants.saved_view.updated',
        entityId: viewId,
        changes: paths(changed),
      });
    }
    return read(tx, context, viewId);
  }

  async function deleteSavedView({
    tx,
    context,
    input,
  }: Args<{ params: { viewId: string } }>): Promise<undefined> {
    const { viewId } = input.params;
    const db = viewDb(tx);
    const row = await db
      .selectFrom('grants.saved_view')
      .select('created_by')
      .where('id', '=', viewId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    const { id, permissions } = context.membership;
    if (row.created_by !== id && !permissions.has('grants.programmes.manage')) {
      throw deps.forbidden();
    }
    await db.deleteFrom('grants.saved_view').where('id', '=', viewId).execute();
    await context.audit.record({
      action: 'grants.saved_view.deleted',
      entityId: viewId,
      changes: paths(FIELDS),
    });
    return undefined;
  }

  return { listSavedViews, getSavedView, createSavedView, updateSavedView, deleteSavedView };
}
