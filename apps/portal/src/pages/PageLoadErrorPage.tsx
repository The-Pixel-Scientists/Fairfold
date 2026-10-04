// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, PageHeading } from '@pixel-scientists/ui';
import type { PageDefinition } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';

const TITLE = 'We could not load this page';

function PageLoadError() {
  return (
    <PageColumn>
      <div className="flex flex-col gap-4">
        <PageHeading className="text-3xl">{TITLE}</PageHeading>
        <p className="max-w-prose text-lg text-ink">
          This is often caused by a weak or lost internet connection. Check that you are online,
          then reload the page. If it still does not load, try again in a few minutes.
        </p>
      </div>
      <div>
        <Button
          variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload page
        </Button>
      </div>
    </PageColumn>
  );
}

/**
 * Shown when a page fails to load. It is bundled with the app, never loaded
 * on demand, because it has to work when the network does not.
 */
export const pageLoadErrorPage: PageDefinition = { title: TITLE, component: PageLoadError };
