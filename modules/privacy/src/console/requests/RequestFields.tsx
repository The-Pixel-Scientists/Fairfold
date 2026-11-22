// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormField, Select, Textarea } from '@pixel-scientists/ui';

import type { RightsRequestUpdate } from '../../contracts/index.ts';
import { Options } from '../parts.tsx';
import { channelWords, identityWords, kindWords } from '../words.ts';

export const REQUEST_FIELDS = ['kind', 'channel', 'identityCheck', 'summary'] as const;

interface Props {
  errorFor: (field: string) => string | undefined;
  initial?: RightsRequestUpdate;
}

/** The fields a request keeps once it is logged. No identity evidence is asked for: only where the check is. */
export function RequestFields({ errorFor, initial }: Props) {
  return (
    <>
      <FormField label="Kind of request" id="kind" error={errorFor('kind')}>
        <Select name="kind" defaultValue={initial?.kind ?? 'access'}>
          <Options words={kindWords} />
        </Select>
      </FormField>
      <FormField label="How it arrived" id="channel" error={errorFor('channel')}>
        <Select name="channel" defaultValue={initial?.channel ?? 'email'}>
          <Options words={channelWords} />
        </Select>
      </FormField>
      <FormField
        label="Identity check"
        id="identityCheck"
        hint="Say where the check is. Do not record the proof itself."
        error={errorFor('identityCheck')}
      >
        <Select name="identityCheck" defaultValue={initial?.identityCheck ?? 'not_started'}>
          <Options words={identityWords} />
        </Select>
      </FormField>
      <FormField
        label="Summary"
        id="summary"
        hint="What the person asked for, in a few lines."
        error={errorFor('summary')}
      >
        <Textarea name="summary" defaultValue={initial?.summary ?? ''} />
      </FormField>
    </>
  );
}
