// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader } from '@pixel-scientists/ui';

import { ManagePage } from './Page.tsx';
import { PROGRAMMES_PATH } from './paths.ts';
import { ProgrammeForm } from './ProgrammeForm.tsx';

export default function NewProgrammePage() {
  return (
    <ManagePage title="New programme">
      <PageHeader
        breadcrumbs={[{ label: 'Programmes', to: PROGRAMMES_PATH }, { label: 'New programme' }]}
        title="New programme"
        description="A programme is one grant you run. Add its rounds, stages and emails once it exists."
      />
      <ProgrammeForm />
    </ManagePage>
  );
}
