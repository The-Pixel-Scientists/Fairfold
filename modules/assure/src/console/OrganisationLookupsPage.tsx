// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader } from '@pixel-scientists/ui';

import { Gate, useParam } from './Gate.tsx';
import { RegistryPanel } from './RegistryPanel.tsx';

export default function OrganisationLookupsPage() {
  const organisationId = useParam('organisationId');
  return (
    <Gate permission="assure.lookup.read">
      <PageHeader
        title="Registry details"
        description="What the charity and company registers say about this organisation."
      />
      <RegistryPanel organisationId={organisationId} />
    </Gate>
  );
}
