// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { FormField, Input } from '@pixel-scientists/ui';

import { signOffDpia } from '../../contracts/index.ts';
import type { Dpia } from '../../contracts/index.ts';
import { ActionDialog, text } from '../parts.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  dpiaId: string;
  onSigned: (dpia: Dpia) => void;
}

/** Signs the DPIA off as the signed-in member: the body carries only when to review it. */
export function SignOffDialog({ open, onClose, dpiaId, onSigned }: Props) {
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Sign off DPIA"
      description="You are signing this assessment off in your own name. Changing it afterwards reopens it."
      submit="Sign off DPIA"
      fields={['reviewOn']}
      action={async (data, idempotencyKey) => {
        onSigned(
          await call(signOffDpia, {
            params: { dpiaId },
            body: { reviewOn: text(data, 'reviewOn') },
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          }),
        );
        onClose();
      }}
    >
      {(errorFor) => (
        <FormField
          label="Review on"
          id="reviewOn"
          hint="The day this assessment should be looked at again."
          error={errorFor('reviewOn')}
        >
          <Input name="reviewOn" type="date" />
        </FormField>
      )}
    </ActionDialog>
  );
}
