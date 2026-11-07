// SPDX-License-Identifier: AGPL-3.0-or-later

import { confirmTotpChange, removeTotp, startTotpChange } from '@pixel-scientists/domain/auth';
import {
  AuthenticatorKey,
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { refused } from '../../auth/failures.ts';
import type { StepUp } from '../../platform/team/useStepUp.tsx';
import { Section, focusWhenSettled, useAction } from './parts.tsx';

export const wrongCode =
  'That code is not right. Your old authenticator app still works. Check the 6 digits in the new app, then try again.';

export function AuthenticatorSection({
  stepUp,
  onSignedOut,
}: {
  stepUp: StepUp;
  /** Replacing or removing the app signs the person out everywhere. */
  onSignedOut: () => void;
}) {
  const [setup, setSetup] = useState<{ key: string; uri: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const action = useAction(stepUp, 'replace-authenticator');
  const intro = useRef<HTMLHeadingElement>(null);
  const replace = useRef<HTMLButtonElement>(null);
  const settingUp = useRef(false);
  // The button and the key form swap places: follow focus to whichever appears.
  useEffect(() => {
    const open = setup !== null;
    if (settingUp.current === open) return;
    settingUp.current = open;
    focusWhenSettled(open ? intro : replace);
  }, [setup]);
  const form = useSubmit(['code'], async (data) => {
    try {
      const done = await stepUp.run(async () => {
        await callApi(confirmTotpChange, { body: { code: formText(data, 'code') } });
        return true;
      });
      if (done) onSignedOut();
    } catch (error) {
      throw refused(error, wrongCode);
    }
  });

  async function start() {
    const started = await action.run(() => callApi(startTotpChange, {}));
    if (started !== null) setSetup(started);
  }

  async function remove() {
    setRemoving(false);
    const done = await action.run(async () => {
      await callApi(removeTotp, {});
      return true;
    });
    if (done !== null) onSignedOut();
  }

  return (
    <Section id="authenticator" title="Authenticator app">
      <p className="text-body text-muted">
        Your authenticator app makes the 6-digit code you enter when you sign in. Replacing or
        removing it signs you out everywhere.
      </p>
      {action.summary}
      {setup === null ? (
        <div className="flex flex-wrap gap-2">
          <Button
            id="replace-authenticator"
            ref={replace}
            onClick={() => {
              void start();
            }}
          >
            Replace authenticator app
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setRemoving(true);
            }}
          >
            Remove authenticator app
          </Button>
        </div>
      ) : (
        <>
          <h3 ref={intro} tabIndex={-1} className="text-body font-semibold text-ink">
            Set up your new app
          </h3>
          <p className="text-body">
            In your new app, add an account with this key, then enter the code it shows.
          </p>
          <AuthenticatorKey secret={setup.key} uri={setup.uri} />
          <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-3 sm:max-w-md">
            <ErrorSummary key={form.attempt} errors={form.errors} />
            <FormField id="code" label="Code from the new app" error={form.errorFor('code')}>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
                Confirm new app
              </Button>
              <Button
                onClick={() => {
                  setSetup(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </>
      )}
      <Dialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove your authenticator app?"
        description="You will be signed out everywhere. You can only remove it if you have another way to sign in."
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setRemoving(false);
              }}
            >
              Keep authenticator app
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void remove();
              }}
            >
              Remove authenticator app
            </Button>
          </>
        }
      />
    </Section>
  );
}
