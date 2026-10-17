// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { Programme } from '../../contracts/index.ts';
import { loadProgramme } from './loaders.ts';
import { ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath } from './paths.ts';
import { ProgrammeForm } from './ProgrammeForm.tsx';

function EditProgramme({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadProgramme, programmeId);
  const [saved, setSaved] = useState<Programme | null>(null);
  const programme = saved ?? (state.status === 'ready' ? state.value : null);

  return (
    <>
      <PageHeader
        breadcrumbs={
          programme
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: programme.title, to: programmePath(programme.id) },
                { label: 'Edit' },
              ]
            : undefined
        }
        title="Edit programme"
      />
      <WhenLoaded state={state} label="Loading the programme" retry={retry}>
        {(loaded) => <ProgrammeForm programme={loaded} onSaved={setSaved} />}
      </WhenLoaded>
    </>
  );
}

export default function EditProgrammePage() {
  return (
    <ManagePage title="Edit programme">
      <EditProgramme programmeId={useParam('programmeId')} />
    </ManagePage>
  );
}
