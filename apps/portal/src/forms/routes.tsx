// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms pages for people who sign in. They come and go with the session
// as every tool's do (shell/gate.tsx), and sit inside a signed-in Screen.

import { idSchema } from '@pixel-scientists/domain';
import {
  RESPONSES_PATH,
  RESPONSE_PATH,
  SIGNED_IN_FORM_PATH,
  loadMyResponse,
  loadMyResponses,
  loadSignedInForm,
} from '@pixel-scientists/forms/portal';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import type { ComponentType } from 'react';

import { Screen } from '../auth/Screen.tsx';
import { PortalFormsHost } from './host.tsx';

function hasId(name: string): SearchSchema<Params> {
  return {
    safeParse: (input) =>
      idSchema.safeParse((input as Params)[name]).success
        ? { success: true, data: input as Params }
        : { success: false, error: null },
  };
}

/** A forms page, loaded when first opened, inside the signed-in frame and the forms host. */
function signedIn(load: () => Promise<{ default: ComponentType }>) {
  return async () => {
    const { default: Page } = await load();
    return {
      default: function FormsPage() {
        return (
          <Screen kind="applicant">
            <PortalFormsHost>
              <Page />
            </PortalFormsHost>
          </Screen>
        );
      },
    };
  };
}

export const formsRoutes: readonly RouteDefinition[] = [
  { path: RESPONSES_PATH, title: 'Your answers', load: signedIn(loadMyResponses) },
  {
    path: RESPONSE_PATH,
    title: 'Your answers',
    params: hasId('responseId'),
    load: signedIn(loadMyResponse),
  },
  {
    path: SIGNED_IN_FORM_PATH,
    title: 'Answer a form',
    params: hasId('formId'),
    load: signedIn(loadSignedInForm),
  },
];
