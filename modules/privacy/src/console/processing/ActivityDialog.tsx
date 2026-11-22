// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input, Select, Textarea } from '@pixel-scientists/ui';

import {
  createProcessingActivity,
  dataCategories,
  subjectCategories,
  updateProcessingActivity,
} from '../../contracts/index.ts';
import type { ProcessingActivity, Processor } from '../../contracts/index.ts';
import { ActionDialog, ChoiceGroup, Options, text, texts } from '../parts.tsx';
import { basisWords, categoryLabel, conditionWords, subjectWords } from '../words.ts';

const FIELDS = [
  'name',
  'purpose',
  'legalBasis',
  'specialCategoryCondition',
  'dataCategories',
  'subjectCategories',
  'recipients',
  'processorIds',
  'transfersAbroad',
  'retention',
  'securityMeasures',
];

interface Props {
  /** The activity to change, `new` to add one, or null while the dialog is closed. */
  target: ProcessingActivity | 'new' | null;
  processors: readonly Processor[];
  onClose: () => void;
  onSaved: () => void;
}

const categoryOptions = dataCategories.map((value) => ({ value, label: categoryLabel(value) }));
const subjectOptions = subjectCategories.map((value) => ({ value, label: subjectWords[value] }));

export function ActivityDialog({ target, processors, onClose, onSaved }: Props) {
  const current = target === 'new' ? null : target;
  return (
    <ActionDialog
      open={target !== null}
      onClose={onClose}
      wide
      title={current === null ? 'Add processing activity' : 'Change processing activity'}
      description="Saving records a new version of your records of processing."
      submit="Save activity"
      fields={FIELDS}
      action={async (data, idempotencyKey) => {
        const body = {
          name: text(data, 'name'),
          purpose: text(data, 'purpose'),
          legalBasis: text(data, 'legalBasis'),
          specialCategoryCondition: text(data, 'specialCategoryCondition') || null,
          dataCategories: texts(data, 'dataCategories'),
          subjectCategories: texts(data, 'subjectCategories'),
          recipients: text(data, 'recipients'),
          processorIds: texts(data, 'processorIds'),
          transfersAbroad: text(data, 'transfersAbroad'),
          retention: text(data, 'retention'),
          securityMeasures: text(data, 'securityMeasures'),
        };
        if (current === null) {
          await call(createProcessingActivity, {
            body,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          });
        } else {
          await call(updateProcessingActivity, { params: { activityId: current.id }, body });
        }
        onSaved();
        onClose();
      }}
    >
      {(errorFor) => (
        <>
          <FormField label="Name" id="name" error={errorFor('name')}>
            <Input name="name" defaultValue={current?.name ?? ''} />
          </FormField>
          <FormField label="What the data is used for" id="purpose" error={errorFor('purpose')}>
            <Textarea name="purpose" defaultValue={current?.purpose ?? ''} />
          </FormField>
          <FormField label="Lawful basis" id="legalBasis" error={errorFor('legalBasis')}>
            <Select name="legalBasis" defaultValue={current?.legalBasis ?? 'legitimate_interests'}>
              <Options words={basisWords} />
            </Select>
          </FormField>
          <FormField
            label="Condition for special category data"
            id="specialCategoryCondition"
            optional
            error={errorFor('specialCategoryCondition')}
          >
            <Select
              name="specialCategoryCondition"
              defaultValue={current?.specialCategoryCondition ?? ''}
            >
              <Options words={conditionWords} blank="None" />
            </Select>
          </FormField>
          <ChoiceGroup
            legend="Kinds of data"
            name="dataCategories"
            options={categoryOptions}
            initial={current?.dataCategories ?? []}
            error={errorFor('dataCategories')}
          />
          <ChoiceGroup
            legend="Whose data"
            name="subjectCategories"
            options={subjectOptions}
            initial={current?.subjectCategories ?? []}
            error={errorFor('subjectCategories')}
          />
          {processors.length > 0 && (
            <ChoiceGroup
              legend="Processors involved"
              name="processorIds"
              options={processors.map(({ id, name }) => ({ value: id, label: name }))}
              initial={current?.processorIds ?? []}
              error={errorFor('processorIds')}
            />
          )}
          <FormField
            label="Who receives it"
            id="recipients"
            optional
            error={errorFor('recipients')}
          >
            <Textarea name="recipients" defaultValue={current?.recipients ?? ''} />
          </FormField>
          <FormField
            label="Transfers abroad"
            id="transfersAbroad"
            optional
            error={errorFor('transfersAbroad')}
          >
            <Textarea name="transfersAbroad" defaultValue={current?.transfersAbroad ?? ''} />
          </FormField>
          <FormField
            label="How long you keep it"
            id="retention"
            optional
            error={errorFor('retention')}
          >
            <Textarea name="retention" defaultValue={current?.retention ?? ''} />
          </FormField>
          <FormField
            label="How you keep it secure"
            id="securityMeasures"
            optional
            error={errorFor('securityMeasures')}
          >
            <Textarea name="securityMeasures" defaultValue={current?.securityMeasures ?? ''} />
          </FormField>
        </>
      )}
    </ActionDialog>
  );
}
