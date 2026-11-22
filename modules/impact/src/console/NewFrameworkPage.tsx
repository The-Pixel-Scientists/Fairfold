// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader } from '@pixel-scientists/ui';

import { FrameworkForm } from './FrameworkForm.tsx';
import { Gate } from './Page.tsx';
import { IMPACT_PATH } from './paths.ts';

export default function NewFrameworkPage() {
  return (
    <Gate permission="impact.frameworks.manage" title="New framework">
      <PageHeader
        breadcrumbs={[{ label: 'Impact', to: IMPACT_PATH }, { label: 'New framework' }]}
        title="New framework"
        description="List the outcomes you want to see, then add an indicator for each way you will measure it. You can change both later."
      />
      <FrameworkForm />
    </Gate>
  );
}
