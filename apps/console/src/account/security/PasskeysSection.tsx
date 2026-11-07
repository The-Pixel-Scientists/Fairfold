// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  addPasskey,
  listPasskeys,
  passkeyNameSchema,
  passkeyRegistrationOptions,
  removePasskey,
} from '@pixel-scientists/domain/auth';
import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  PasskeyList,
  WhenLoaded,
  createPasskey,
  formText,
  passkeysSupported,
  useLoad,
  useSubmit,
} from '@pixel-scientists/ui';
import type { PasskeyItem } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import type { StepUp } from '../../platform/team/useStepUp.tsx';
import { Result, Section, focusWhenSettled, useAction } from './parts.tsx';

const loadPasskeys = () => callApi(listPasskeys, {}).then(({ passkeys }) => passkeys);

const refusal = {
  cancelled:
    'The passkey was not added and nothing has changed. Choose Add a passkey and approve the prompt on your device.',
  failed:
    'Your device could not make a passkey, and nothing has changed. Try again, or use another device or an authenticator app.',
  unsupported: 'This browser cannot make passkeys. Use another browser or an authenticator app.',
} as const;

export function PasskeysSection({ stepUp }: { stepUp: StepUp }) {
  const { state, retry } = useLoad(loadPasskeys);
  const [changed, setChanged] = useState<readonly PasskeyItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [removing, setRemoving] = useState<PasskeyItem | null>(null);
  const [version, setVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const removal = useAction(stepUp, 'passkeys');
  const supported = passkeysSupported();
  const list = changed ?? (state.status === 'ready' ? state.value : []);

  const form = useSubmit(['name'], async (data) => {
    const name = passkeyNameSchema.safeParse(formText(data, 'name'));
    if (!name.success) {
      throw new ProblemError(400, 'Check the passkey name.', {
        errors: [{ field: 'body.name', message: name.error.issues[0]?.message ?? 'Enter a name.' }],
      });
    }
    const added = await stepUp.run(async () => {
      const made = await createPasskey(await callApi(passkeyRegistrationOptions, {}));
      if (made.status !== 'ok') throw new ProblemError(400, refusal[made.status]);
      return callApi(addPasskey, { body: { name: name.data, credential: made.credential } });
    });
    if (added === null) return;
    setChanged([...list, added]);
    setMessage(`Passkey ${added.name} added.`);
    setVersion((current) => current + 1);
    focusWhenSettled(heading);
  });

  async function remove(passkey: PasskeyItem) {
    setRemoving(null);
    const done = await removal.run(async () => {
      await callApi(removePasskey, { params: { passkeyId: passkey.id } });
      return true;
    });
    if (done === null) return;
    setChanged(list.filter(({ id }) => id !== passkey.id));
    setMessage(`Passkey ${passkey.name} removed.`);
    focusWhenSettled(heading);
  }

  return (
    <Section id="passkeys" title="Passkeys" headingRef={heading}>
      <p className="text-body text-muted">
        A passkey signs you in with your fingerprint, face or screen lock instead of a code.
      </p>
      {removal.summary}
      <Result>{message}</Result>
      <WhenLoaded state={state} label="Loading your passkeys" retry={retry}>
        {() => (
          <PasskeyList
            passkeys={list}
            label="Your passkeys"
            empty={<p>You have no passkeys. Add one to sign in without a code.</p>}
            onRemove={setRemoving}
          />
        )}
      </WhenLoaded>
      {supported ? (
        <form
          key={`add-${String(version)}`}
          noValidate
          onSubmit={form.onSubmit}
          className="flex flex-col gap-3 sm:max-w-md"
        >
          <ErrorSummary key={form.attempt} errors={form.errors} />
          <FormField
            id="name"
            label="Name for the passkey"
            hint="For example, Work laptop."
            error={form.errorFor('name')}
          >
            <Input name="name" autoComplete="off" />
          </FormField>
          <div>
            <Button type="submit" aria-disabled={form.pending || undefined}>
              Add a passkey
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-body text-muted">
          This browser cannot make passkeys, so Add a passkey is not shown. Use another browser to
          add one.
        </p>
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this passkey?"
        description={
          removing === null
            ? undefined
            : `You will no longer be able to sign in with ${removing.name}. You will be asked to confirm it is you.`
        }
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setRemoving(null);
              }}
            >
              Keep passkey
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing !== null) void remove(removing);
              }}
            >
              Remove passkey
            </Button>
          </>
        }
      />
    </Section>
  );
}
