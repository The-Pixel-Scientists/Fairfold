// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormField, LoadingState, Select, useLoad } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { adjustmentMessages } from '../../../contracts/index.ts';
import { problemLines } from '../../assessment/problems.ts';
import { useStepUp } from '../../decisions/useStepUp.tsx';
import { loadContacts, startAssisted } from './loaders.ts';

export interface StartTarget {
  roundId: string;
  organisation: { id: string; name: string };
}

function StartForm({
  target,
  onClose,
  onStarted,
}: {
  target: StartTarget;
  onClose: () => void;
  onStarted: (applicationId: string) => void;
}) {
  const { state, retry } = useLoad(loadContacts, target.organisation.id);
  const stepUp = useStepUp();
  const [person, setPerson] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(person === '' ? adjustmentMessages.notContact : undefined);
    if (person === '') return;
    setPending(true);
    setFailure([]);
    try {
      const started = await stepUp.run(() =>
        startAssisted(target.roundId, {
          organisationId: target.organisation.id,
          contactPersonId: person,
        }),
      );
      if (started !== null) onStarted(started.id);
    } catch (problem) {
      setFailure(problemLines(problem));
    } finally {
      setPending(false);
    }
  }

  if (state.status === 'loading') return <LoadingState label="Loading contacts" />;
  if (state.status === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-body text-danger">{state.message}</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (state.value.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          {target.organisation.name} has no current contact. Add a contact to the organisation, then
          start the application.
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      {failure.length > 0 && (
        <p role="alert" className="font-medium text-danger">
          {failure.join(' ')}
        </p>
      )}
      <FormField id="contactPersonId" label="Who is applying?" error={error}>
        <Select
          value={person}
          onChange={(event) => {
            setPerson(event.currentTarget.value);
          }}
        >
          <option value="">Choose a contact</option>
          {state.value.map((contact) => (
            <option key={contact.personId} value={contact.personId}>
              {[contact.givenName, contact.familyName].filter(Boolean).join(' ') || contact.email}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          Start application for {target.organisation.name}
        </Button>
      </div>
      {stepUp.dialog}
    </form>
  );
}

export interface StartDialogProps {
  /** The organisation to start for. The dialog is open while there is one. */
  target: StartTarget | null;
  onClose: () => void;
  onStarted: (applicationId: string) => void;
}

/** Starts an application for an organisation that has the alternative route, for one of its current contacts. */
export function StartDialog({ target, onClose, onStarted }: StartDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Start an application for an applicant"
      description="You fill in the application and submit it for them. They are told when you submit it."
    >
      {target !== null && <StartForm target={target} onClose={onClose} onStarted={onStarted} />}
    </Dialog>
  );
}
