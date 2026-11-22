// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Select, Textarea } from '@pixel-scientists/ui';

import { assessBreach } from '../../contracts/index.ts';
import type { Breach } from '../../contracts/index.ts';
import { ActionDialog, Options, text } from '../parts.tsx';
import { riskWords } from '../words.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  breachId: string;
  onRecorded: (assessment: Breach['assessments'][number]) => void;
}

const yesNo = (tell: string) => (
  <>
    <option value="no">No</option>
    <option value="yes">{tell}</option>
  </>
);

/** Adds to the history of assessments; earlier ones are never changed. The assessor is the session's member. */
export function AssessDialog({ open, onClose, breachId, onRecorded }: Props) {
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Add assessment"
      description="Each assessment is kept as it is. Add another if the picture changes. Nothing is sent to anyone."
      submit="Add assessment"
      fields={['riskLevel', 'notifyIco', 'notifySubjects', 'rationale']}
      action={async (data, idempotencyKey) => {
        onRecorded(
          await call(assessBreach, {
            params: { breachId },
            body: {
              riskLevel: text(data, 'riskLevel'),
              notifyIco: text(data, 'notifyIco') === 'yes',
              notifySubjects: text(data, 'notifySubjects') === 'yes',
              rationale: text(data, 'rationale'),
            },
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          }),
        );
        onClose();
      }}
    >
      {(errorFor) => (
        <>
          <FormField label="Risk to people" id="riskLevel" error={errorFor('riskLevel')}>
            <Select name="riskLevel" defaultValue="risk">
              <Options words={riskWords} />
            </Select>
          </FormField>
          <FormField
            label="Does the ICO need to be told?"
            id="notifyIco"
            error={errorFor('notifyIco')}
          >
            <Select name="notifyIco" defaultValue="no">
              {yesNo('Yes, tell the ICO')}
            </Select>
          </FormField>
          <FormField
            label="Do the people affected need to be told?"
            id="notifySubjects"
            error={errorFor('notifySubjects')}
          >
            <Select name="notifySubjects" defaultValue="no">
              {yesNo('Yes, tell the people affected')}
            </Select>
          </FormField>
          <FormField label="Why" id="rationale" optional error={errorFor('rationale')}>
            <Textarea name="rationale" />
          </FormField>
        </>
      )}
    </ActionDialog>
  );
}
