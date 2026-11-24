// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's staff screens: the form list, which the console opens
// at `/forms`, and the routes under it. Each page loads only when it is
// first opened, and every page shows the funder's not-found page to a member
// without the permission, so a hidden tool leaves no trace.

import { idSchema } from '@pixel-scientists/domain';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import { lazy } from 'react';

import { FORMS_PATH, NEW_FORM_PATH, TEMPLATES_PATH } from './paths.ts';

export default lazy(() => import('./list/FormsListPage.tsx'));

/** Only real ids are the addresses of forms, so `/forms/new` and typing mistakes never reach them. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

export const formsRoutes: readonly RouteDefinition[] = [
  { path: FORMS_PATH, title: 'Forms', load: () => import('./list/FormsListPage.tsx') },
  { path: NEW_FORM_PATH, title: 'Create form', load: () => import('./list/NewFormPage.tsx') },
  {
    path: TEMPLATES_PATH,
    title: 'Start from a template',
    load: () => import('./templates/TemplatesPage.tsx'),
  },
  {
    path: '/forms/templates/:templateId',
    title: 'Template',
    params: ids,
    load: () => import('./templates/TemplatePage.tsx'),
  },
  {
    path: '/forms/:formId',
    title: 'Form',
    params: ids,
    load: () => import('./builder/BuilderPage.tsx'),
  },
  {
    path: '/forms/:formId/settings',
    title: 'Form settings',
    params: ids,
    load: () => import('./settings/SettingsPage.tsx'),
  },
  {
    path: '/forms/:formId/responses',
    title: 'Responses',
    params: ids,
    load: () => import('./responses/ResponsesPage.tsx'),
  },
  {
    path: '/forms/:formId/responses/:responseId',
    title: 'Response',
    params: ids,
    load: () => import('./responses/ResponsePage.tsx'),
  },
];
