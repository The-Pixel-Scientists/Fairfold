// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';

import { loadProgramme } from './loaders.ts';
import { ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath } from './paths.ts';
import { RoundForm } from './RoundForm.tsx';

function NewRound({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadProgramme, programmeId);
  const programme = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          programme
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: programme.title, to: programmePath(programme.id) },
                { label: 'New round' },
              ]
            : undefined
        }
        title="New round"
        description="A round starts with the stages Intake, Review and Decision. You can change them once it is added."
      />
      <WhenLoaded state={state} label="Loading the programme" retry={retry}>
        {(loaded) => <RoundForm programme={loaded} />}
      </WhenLoaded>
    </>
  );
}

export default function NewRoundPage() {
  return (
    <ManagePage title="New round">
      <NewRound programmeId={useParam('programmeId')} />
    </ManagePage>
  );
}
