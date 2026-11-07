// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Saved view routes (E7, ADR 0004), for members with
// `grants.applications.read` anywhere in the session's tenant. Every such
// member lists, reads and uses every view (schemas.ts says how each use is
// re-checked). The server (S12-39) holds the rest:
// - the member who saved a view is the session's membership (rule 6), and
//   only they update it, renaming it included;
// - they delete it, and so does any member holding
//   `grants.programmes.manage`; anyone else gets 403, and another tenant's
//   view answers 404;
// - creating, updating and deleting record `grants.saved_view.created`,
//   `.updated` and `.deleted` with the view id and the changed field paths
//   (`name`, `filter`, `sort`, `columns`), never the name or filter values.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { savedViewListSchema, savedViewSchema, viewInputSchema } from './schemas.ts';

const staff = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.read',
  scope: 'tenant',
} as const;

const view = { ...staff, params: z.strictObject({ viewId: idSchema }) } as const;

export const listSavedViews = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/saved-views',
  summary: "List the tenant's saved views of the submissions list",
  responses: { 200: savedViewListSchema },
});

export const getSavedView = defineRoute({
  ...view,
  method: 'GET',
  path: '/console/saved-views/:viewId',
  summary: 'Read a saved view',
  responses: { 200: savedViewSchema },
});

export const createSavedView = defineRoute({
  ...staff,
  method: 'POST',
  idempotent: true,
  path: '/console/saved-views',
  summary: 'Save the submissions list filters, sort and columns as a view the team can use',
  body: viewInputSchema,
  responses: { 201: savedViewSchema },
});

export const updateSavedView = defineRoute({
  ...view,
  method: 'PUT',
  path: '/console/saved-views/:viewId',
  summary: 'Rename or change a saved view you saved',
  body: viewInputSchema,
  responses: { 200: savedViewSchema },
});

export const deleteSavedView = defineRoute({
  ...view,
  method: 'DELETE',
  path: '/console/saved-views/:viewId',
  summary: 'Delete a saved view',
  responses: { 204: null },
});

export const savedViewRoutes = {
  listSavedViews,
  getSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} as const;
