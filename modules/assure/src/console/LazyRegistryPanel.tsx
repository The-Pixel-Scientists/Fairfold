// SPDX-License-Identifier: AGPL-3.0-or-later

import { LoadingState } from '@pixel-scientists/ui';
import { Suspense, lazy } from 'react';

const Panel = lazy(() =>
  import('./RegistryPanel.tsx').then(({ RegistryPanel }) => ({ default: RegistryPanel })),
);

/** `RegistryPanel` for another module's page: its code loads when the panel first shows. */
export function LazyRegistryPanel({ organisationId }: { organisationId: string }) {
  return (
    <Suspense fallback={<LoadingState label="Loading registry details" />}>
      <Panel organisationId={organisationId} />
    </Suspense>
  );
}
