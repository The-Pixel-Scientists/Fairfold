// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { Round } from '../../contracts/index.ts';
import { loadRound } from './loaders.ts';
import { ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath, roundPath } from './paths.ts';
import { RoundForm } from './RoundForm.tsx';

function EditRound({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadRound, roundId);
  const [saved, setSaved] = useState<Round | null>(null);
  const loaded = state.status === 'ready' ? state.value : null;
  const round = saved ?? loaded?.round;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded && round
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: loaded.programme.title, to: programmePath(loaded.programme.id) },
                { label: round.title, to: roundPath(round.id) },
                { label: 'Edit' },
              ]
            : undefined
        }
        title="Edit round"
      />
      <WhenLoaded state={state} label="Loading the round" retry={retry}>
        {(value) => (
          <RoundForm programme={value.programme} round={value.round} onSaved={setSaved} />
        )}
      </WhenLoaded>
    </>
  );
}

export default function EditRoundPage() {
  return (
    <ManagePage title="Edit round">
      <EditRound roundId={useParam('roundId')} />
    </ManagePage>
  );
}
