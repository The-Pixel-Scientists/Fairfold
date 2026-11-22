// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader } from '@pixel-scientists/ui';

import { ChecklistResponses } from './checklists/ResponsePanel.tsx';
import { FlagsPanel } from './duplicates/FlagsPanel.tsx';
import { Gate, useParam } from './Gate.tsx';

/** Assure's view of one application: its advisory flags and its checklist answers. */
export default function ApplicationPage() {
  const applicationId = useParam('applicationId');
  return (
    <Gate permission={['assure.duplicates.review', 'assure.checklists.complete']}>
      <PageHeader
        title="Due diligence"
        description="Possible duplicates and checklist answers for this application."
      />
      <FlagsPanel applicationId={applicationId} />
      <ChecklistResponses applicationId={applicationId} />
    </Gate>
  );
}
