// SPDX-License-Identifier: AGPL-3.0-or-later

import { LoadingState } from '@pixel-scientists/ui';
import { Suspense, lazy } from 'react';

const Flags = lazy(() =>
  import('./duplicates/FlagsPanel.tsx').then(({ FlagsPanel }) => ({ default: FlagsPanel })),
);
const Responses = lazy(() =>
  import('./checklists/ResponsePanel.tsx').then(({ ChecklistResponses }) => ({
    default: ChecklistResponses,
  })),
);

/** `FlagsPanel` for another module's page: its code loads when the panel first shows. */
export function LazyFlagsPanel({ applicationId }: { applicationId: string }) {
  return (
    <Suspense fallback={<LoadingState label="Loading possible duplicates" />}>
      <Flags applicationId={applicationId} />
    </Suspense>
  );
}

/** `ChecklistResponses` for another module's page, loaded the same way. */
export function LazyChecklistResponses({ applicationId }: { applicationId: string }) {
  return (
    <Suspense fallback={<LoadingState label="Loading checklists" />}>
      <Responses applicationId={applicationId} />
    </Suspense>
  );
}
