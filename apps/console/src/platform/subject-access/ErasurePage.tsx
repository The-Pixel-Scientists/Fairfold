// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The erasure confirmation: its own page, calm and unhurried. It asks the
// admin to confirm it is them before anything is chosen, so nothing is lost to
// the round trip. One person per request; nothing here erases in bulk.

import {
  erasureReasons,
  erasureRequestSchema,
  requestErasure,
} from '@pixel-scientists/domain/platform/subject-access';
import type { ErasureReason } from '@pixel-scientists/domain/platform/subject-access';
import {
  Button,
  Checkbox,
  ErrorSummary,
  LoadingState,
  Notice,
  PageHeader,
  RadioGroup,
  WhenLoaded,
  useLoad,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { useStepUp } from '../team/useStepUp.tsx';
import type { StepUp } from '../team/useStepUp.tsx';
import { NotFound, useIdParam } from './common.tsx';
import { loadPerson } from './person.ts';
import { SUBJECT_ACCESS_PATH, erasureStatusPath, personPath } from './paths.ts';

const reasonLabels: Record<ErasureReason, string> = {
  subject_request: 'The person asked for their data to be erased',
  tenant_instruction: 'Your funder has decided to erase it',
};

const consequences = [
  'Their personal data is removed or anonymised in every tool, including tools that are switched off.',
  'Their record is kept but marked as erased.',
  'Applications, scores, decisions and the audit trail are kept, with ids and codes only. No outcome changes.',
  'The erasure is recorded, so restoring a backup does not bring the data back.',
  'It cannot be undone.',
];

function Confirm({ partyId, name, stepUp }: { partyId: string; name: string; stepUp: StepUp }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const form = useSubmit(['reason', 'confirm'], async () => {
    const body = erasureRequestSchema.parse({ partyId, reason, confirm: understood });
    const accepted = await stepUp.run(() => callApi(requestErasure, { body }));
    if (accepted !== null) navigate(erasureStatusPath(accepted.requestId));
  });

  return (
    <form
      noValidate
      onSubmit={form.onSubmit}
      aria-label={`Erase personal data for ${name}`}
      className="flex flex-col gap-5"
    >
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <Notice tone="warning" title={`What happens when you erase ${name}`}>
        <ul role="list" className="list-disc pl-5">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Notice>
      <RadioGroup
        legend="Why is this data being erased?"
        name="reason"
        id="reason"
        value={reason}
        onValueChange={setReason}
        error={form.errorFor('reason')}
        options={erasureReasons.map((value) => ({ value, label: reasonLabels[value] }))}
      />
      <Checkbox
        id="confirm"
        label="I understand this cannot be undone"
        checked={understood}
        onCheckedChange={setUnderstood}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="danger"
          disabled={reason === '' || !understood || form.pending}
        >
          Erase personal data for {name}
        </Button>
      </div>
    </form>
  );
}

function Erasure({ partyId }: { partyId: string }) {
  const navigate = useNavigate();
  const stepUp = useStepUp();
  const { state, retry } = useLoad(loadPerson, partyId);
  const [confirmed, setConfirmed] = useState(false);
  const asked = useRef(false);

  // Step-up comes first, as the page opens. Cancelling it goes back to the person.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void stepUp.ensure().then((done) => {
      if (done) setConfirmed(true);
      else navigate(personPath(partyId));
    });
  }, [stepUp, navigate, partyId]);

  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <PageHeader
        title="Erase personal data"
        breadcrumbs={[
          { label: 'Subject access and erasure', to: SUBJECT_ACCESS_PATH },
          { label: 'Erase personal data' },
        ]}
      />
      <SettingsSections />
      {confirmed ? (
        <WhenLoaded state={state} label="Loading this person" retry={retry}>
          {(person) =>
            person.status === 'found' ? (
              <Confirm partyId={partyId} name={person.name} stepUp={stepUp} />
            ) : (
              <NotFound />
            )
          }
        </WhenLoaded>
      ) : (
        <LoadingState
          label="Waiting for you to confirm it is you"
          className="rounded-lg bg-surface"
        />
      )}
      {stepUp.dialog}
    </div>
  );
}

/** The confirmation for erasing one person, naming them and saying what happens. */
export default function ErasurePage() {
  const partyId = useIdParam('partyId');
  return partyId === null ? <NotFound /> : <Erasure partyId={partyId} />;
}
