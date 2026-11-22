// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input, Textarea } from '@pixel-scientists/ui';

import { createBreach, dataCategories } from '../../contracts/index.ts';
import { useNow, useZone } from '../hooks.ts';
import { ActionDialog, ChoiceGroup, refuse, text, texts } from '../parts.tsx';
import { categoryLabel, instantFrom, localInput } from '../words.ts';

const FIELDS = [
  'becameAwareAt',
  'discoveredAt',
  'description',
  'dataCategories',
  'approximateSubjects',
  'approximateRecords',
  'likelyConsequences',
  'measuresTaken',
];

const options = dataCategories.map((category) => ({
  value: category,
  label: categoryLabel(category),
}));

/** A count that may be left blank when it is not known; anything else is left for the server to check. */
const count = (data: FormData, name: string): number | null => {
  const value = text(data, name).trim();
  return value === '' ? null : Number(value);
};

interface Props {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

/** Records a breach, which starts its 72-hour clock from when the funder became aware. The recorder is the session's member. */
export function RecordBreachDialog({ open, onClose, onRecorded }: Props) {
  const zone = useZone();
  const now = localInput(useNow(), zone);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      wide
      title="Record breach"
      description="Nothing is sent to the ICO or to anyone else. This only records what happened."
      submit="Record breach"
      fields={FIELDS}
      action={async (data, idempotencyKey) => {
        const becameAwareAt = instantFrom(text(data, 'becameAwareAt'), zone);
        if (becameAwareAt === null) {
          throw refuse('becameAwareAt', 'Enter when you became aware of the breach.');
        }
        const discoveredAt = instantFrom(text(data, 'discoveredAt'), zone);
        if (discoveredAt === null) throw refuse('discoveredAt', 'Enter when the breach was found.');
        await call(createBreach, {
          body: {
            becameAwareAt,
            discoveredAt,
            description: text(data, 'description'),
            dataCategories: texts(data, 'dataCategories'),
            approximateSubjects: count(data, 'approximateSubjects'),
            approximateRecords: count(data, 'approximateRecords'),
            likelyConsequences: text(data, 'likelyConsequences'),
            measuresTaken: text(data, 'measuresTaken'),
          },
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        });
        onRecorded();
        onClose();
      }}
    >
      {(errorFor) => (
        <>
          <FormField
            label="When you became aware"
            id="becameAwareAt"
            hint="This starts the 72-hour clock."
            error={errorFor('becameAwareAt')}
          >
            <Input name="becameAwareAt" type="datetime-local" defaultValue={now} max={now} />
          </FormField>
          <FormField
            label="When the breach was found"
            id="discoveredAt"
            error={errorFor('discoveredAt')}
          >
            <Input name="discoveredAt" type="datetime-local" defaultValue={now} max={now} />
          </FormField>
          <FormField label="What happened" id="description" error={errorFor('description')}>
            <Textarea name="description" />
          </FormField>
          <ChoiceGroup
            legend="Kinds of data involved"
            name="dataCategories"
            hint="Special category data needs extra care. The choices that are special category say so."
            options={options}
            error={errorFor('dataCategories')}
          />
          <FormField
            label="People affected, roughly"
            id="approximateSubjects"
            optional
            hint="Leave it blank if you do not know."
            error={errorFor('approximateSubjects')}
          >
            <Input name="approximateSubjects" inputMode="numeric" autoComplete="off" />
          </FormField>
          <FormField
            label="Records affected, roughly"
            id="approximateRecords"
            optional
            error={errorFor('approximateRecords')}
          >
            <Input name="approximateRecords" inputMode="numeric" autoComplete="off" />
          </FormField>
          <FormField
            label="Likely consequences"
            id="likelyConsequences"
            optional
            error={errorFor('likelyConsequences')}
          >
            <Textarea name="likelyConsequences" />
          </FormField>
          <FormField
            label="What you have done about it"
            id="measuresTaken"
            optional
            error={errorFor('measuresTaken')}
          >
            <Textarea name="measuresTaken" />
          </FormField>
        </>
      )}
    </ActionDialog>
  );
}
