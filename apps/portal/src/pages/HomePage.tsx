// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, Link, PageHeading, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';
import { HOW_APPLYING_WORKS_PATH } from '../paths.ts';

/**
 * The portal's first page. Programmes cannot be browsed yet, so it says so
 * plainly and points to the one thing an applicant can read today.
 */
export default function HomePage() {
  return (
    <PageColumn>
      <div className="flex flex-col gap-4">
        <PageHeading className="text-3xl">Apply for a grant</PageHeading>
        <p className="max-w-prose text-lg text-ink">
          When a grant opens, you will check that you can apply first. Then you will fill in your
          application at your own pace.
        </p>
      </div>
      <EmptyState
        title="No grants are open yet"
        action={
          <Link to={HOW_APPLYING_WORKS_PATH} className={buttonClassName('secondary')}>
            Read how applying works
          </Link>
        }
      >
        <p>Open grants will appear here. You do not need to do anything now.</p>
      </EmptyState>
    </PageColumn>
  );
}
