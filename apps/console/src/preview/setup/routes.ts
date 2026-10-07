// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: Setting up programmes, rounds, rubrics and forms.

import type { RouteDefinition } from '@pixel-scientists/ui';

export const formPath = '/programmes/community-grants/spring-2027/form';
export const formPreviewPath = `${formPath}/preview`;

export const setupRoutes: readonly RouteDefinition[] = [
  {
    path: '/programmes',
    title: 'Programmes',
    load: () => import('./Programmes.tsx'),
  },
  {
    path: '/programmes/community-grants',
    title: 'Community Grants',
    load: () => import('./CommunityGrants.tsx'),
  },
  {
    path: '/programmes/community-grants/spring-2027',
    title: 'Spring 2027 round',
    load: () => import('./Round.tsx'),
  },
  {
    path: '/programmes/community-grants/spring-2027/rubric',
    title: 'Spring 2027 rubric',
    load: () => import('./Rubric.tsx'),
  },
  { path: formPath, title: 'Spring 2027 form builder', load: () => import('./FormBuilder.tsx') },
  {
    path: formPreviewPath,
    title: 'Spring 2027 form preview',
    load: () => import('./FormPreview.tsx'),
  },
];
