// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input, Select } from '@pixel-scientists/ui';

import { createProcessor, updateProcessor } from '../../contracts/index.ts';
import type { Processor } from '../../contracts/index.ts';
import { ActionDialog, Options, text } from '../parts.tsx';
import { safeguardWords } from '../words.ts';

interface Props {
  /** The processor to change, `new` to add one, or null while the dialog is closed. */
  target: Processor | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProcessorDialog({ target, onClose, onSaved }: Props) {
  const current = target === 'new' ? null : target;
  return (
    <ActionDialog
      open={target !== null}
      onClose={onClose}
      title={current === null ? 'Add processor' : 'Change processor'}
      description="Saving records a new version of your records of processing."
      submit="Save processor"
      fields={['name', 'service', 'countryCode', 'contractSignedOn', 'transferSafeguard']}
      action={async (data, idempotencyKey) => {
        const body = {
          name: text(data, 'name'),
          service: text(data, 'service'),
          countryCode: text(data, 'countryCode').trim().toUpperCase(),
          contractSignedOn: text(data, 'contractSignedOn') || null,
          transferSafeguard: text(data, 'transferSafeguard') || null,
        };
        if (current === null) {
          await call(createProcessor, {
            body,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          });
        } else {
          await call(updateProcessor, { params: { processorId: current.id }, body });
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
          <FormField label="What they do for you" id="service" error={errorFor('service')}>
            <Input name="service" defaultValue={current?.service ?? ''} />
          </FormField>
          <FormField
            label="Country"
            id="countryCode"
            hint="The two-letter country code, such as GB."
            error={errorFor('countryCode')}
          >
            <Input
              name="countryCode"
              defaultValue={current?.countryCode ?? 'GB'}
              maxLength={2}
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="Contract signed on"
            id="contractSignedOn"
            optional
            error={errorFor('contractSignedOn')}
          >
            <Input
              name="contractSignedOn"
              type="date"
              defaultValue={current?.contractSignedOn ?? ''}
            />
          </FormField>
          <FormField
            label="Transfer safeguard"
            id="transferSafeguard"
            optional
            error={errorFor('transferSafeguard')}
          >
            <Select name="transferSafeguard" defaultValue={current?.transferSafeguard ?? ''}>
              <Options words={safeguardWords} blank="None" />
            </Select>
          </FormField>
        </>
      )}
    </ActionDialog>
  );
}
