// SPDX-License-Identifier: AGPL-3.0-or-later

import { confirmTotp, enrolTotp } from '@pixel-scientists/domain/auth';
import {
  AuthenticatorKey,
  Button,
  ErrorSummary,
  FormField,
  Input,
  LoadingState,
  PageHeading,
  asProblem,
  formText,
  useSession,
  useSubmit,
} from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { callApi } from '../api.ts';
import { codeNotRight, refused } from './failures.ts';
import { Screen } from './Screen.tsx';

type Setup =
  | { status: 'loading' }
  | { status: 'ready'; key: string; uri: string }
  | { status: 'failed'; message: string };

function SetUp() {
  const { setSession, refresh } = useSession();
  const [setup, setSetup] = useState<Setup>({ status: 'loading' });
  const requested = useRef(false);

  const request = useCallback(async () => {
    try {
      const { key, uri } = await callApi(enrolTotp, {});
      setSetup({ status: 'ready', key, uri });
    } catch (error) {
      setSetup({
        status: 'failed',
        message: asProblem(error)?.detail ?? 'Something went wrong. Try again.',
      });
      // The session may have ended, which sends the person back to sign in.
      void refresh().catch(() => undefined);
    }
  }, [refresh]);

  // Each request makes a new key, so one page visit asks only once, even when development runs effects twice.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void request();
  }, [request]);

  const form = useSubmit(['code'], async (data) => {
    try {
      setSession(await callApi(confirmTotp, { body: { code: formText(data, 'code') } }));
    } catch (error) {
      void refresh().catch(() => undefined);
      throw refused(error, codeNotRight);
    }
  });

  return (
    <>
      <PageHeading>Set up your authenticator app</PageHeading>
      <p className="text-body text-muted">
        Staff accounts need a 6-digit code from an authenticator app each time you sign in. Setting
        up takes about 2 minutes.
      </p>
      {setup.status === 'loading' && <LoadingState label="Getting your set-up key" />}
      {setup.status === 'failed' && (
        <>
          <p role="alert" className="text-body font-medium text-danger">
            {setup.message}
          </p>
          <div>
            <Button
              onClick={() => {
                setSetup({ status: 'loading' });
                void request();
              }}
            >
              Get a set-up key
            </Button>
          </div>
        </>
      )}
      {setup.status === 'ready' && (
        <>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
            <li>Install an authenticator app on your phone, if you do not have one.</li>
            <li>In the app, add an account and type in the set-up key below.</li>
            <li>Enter the 6-digit code the app shows, then finish.</li>
          </ol>
          <AuthenticatorKey secret={setup.key} uri={setup.uri} />
          <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
            <ErrorSummary key={form.attempt} errors={form.errors} />
            <FormField
              id="code"
              label="Code from your app"
              hint="The 6 digits the app shows for this account."
              error={form.errorFor('code')}
            >
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
              />
            </FormField>
            <div>
              <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
                Finish set-up
              </Button>
            </div>
          </form>
        </>
      )}
    </>
  );
}

export default function SetUpAuthenticatorPage() {
  return (
    <Screen kind="enrol">
      <SetUp />
    </Screen>
  );
}
