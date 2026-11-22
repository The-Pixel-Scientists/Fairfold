// SPDX-License-Identifier: AGPL-3.0-or-later

import { LoadingState } from '@pixel-scientists/ui';
import { lazy, Suspense } from 'react';

const Search = lazy(() => import('./SearchPage.tsx'));

/** The section's landing page. Its code loads when the page first shows. */
export default function Landing() {
  return (
    <Suspense fallback={<LoadingState label="Loading records" />}>
      <Search />
    </Suspense>
  );
}
