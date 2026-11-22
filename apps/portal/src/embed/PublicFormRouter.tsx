// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one page anyone can open without signing in: a form on the funder's
// address, or in a frame on the funder's website. It reads no session and
// sets no cookie, and the portal and the embed share it.

import { idSchema } from '@pixel-scientists/domain';
import {
  FormsHostProvider,
  PUBLIC_FORM_PATH,
  loadPublicForm,
  useMemoryDraft,
} from '@pixel-scientists/forms/portal';
import type { FormsHost } from '@pixel-scientists/forms/portal';
import { Router } from '@pixel-scientists/ui';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import type { ComponentType, ReactNode } from 'react';

import { callApi } from '../api.ts';
import { pageLoadErrorPage } from '../pages/PageLoadErrorPage.tsx';
import { productName } from '../product.ts';

const formParams: SearchSchema<Params> = {
  safeParse: (input) =>
    idSchema.safeParse((input as Params)['formId']).success
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

/** `/<slug>/forms/<form id>`, the only address this router answers. */
export function isPublicFormPath(slug: string, pathname: string): boolean {
  const [, first, second, third, ...rest] = pathname.split('/');
  return (
    first === slug &&
    second === 'forms' &&
    idSchema.safeParse(third).success &&
    rest.every((part) => part === '')
  );
}

const routes: readonly RouteDefinition[] = [
  { path: PUBLIC_FORM_PATH, title: 'Answer a form', params: formParams, load: loadPublicForm },
];

export interface PublicFormRouterProps {
  slug: string;
  /** In a frame on another website. */
  embedded: boolean;
  /** The frame around the page. Define it at module level. */
  layout: ComponentType<{ children: ReactNode }>;
}

export function PublicFormRouter({ slug, embedded, layout }: PublicFormRouterProps) {
  const host: FormsHost = { call: callApi, slug, embedded, useDraft: useMemoryDraft };
  return (
    <FormsHostProvider host={host}>
      <Router
        routes={routes}
        layout={layout}
        errorPage={pageLoadErrorPage}
        basePath={`/${slug}`}
        titleSuffix={productName}
      />
    </FormsHostProvider>
  );
}
