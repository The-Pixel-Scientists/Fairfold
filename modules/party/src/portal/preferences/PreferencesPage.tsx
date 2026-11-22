// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "How we contact you": one yes or no choice for each purpose and channel the
// contract lists, saved one at a time. The person is never named in a request;
// the server finds them from the session.

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { changePreference, getPreferences } from '@pixel-scientists/party/contracts';
import type { Preferences } from '@pixel-scientists/party/contracts';
import {
  Button,
  ErrorSummary,
  LoadingState,
  PageHeading,
  RadioGroup,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { preferenceLabel } from './wording.ts';

/** The version of the privacy notice shown with the choice. The same one the portal's profile pages record. */
const PRIVACY_NOTICE_VERSION = '1.0';
const CHOOSE = 'Choose yes or no.';
const options = [
  { value: 'given', label: 'Yes' },
  { value: 'withdrawn', label: 'No' },
];

type Preference = Preferences['preferences'][number];

function Row({ preference }: { preference: Preference }) {
  const { purpose, channel } = preference;
  const field = `preference-${purpose}-${channel}`;
  const label = preferenceLabel(purpose, channel);
  const [saved, setSaved] = useState(preference.state);
  const [choice, setChoice] = useState<string>(preference.state ?? '');
  const [status, setStatus] = useState('');
  useLeaveGuard(choice !== (saved ?? ''));

  const form = useSubmit([field], async () => {
    setStatus('');
    if (choice !== 'given' && choice !== 'withdrawn') {
      throw new ProblemError(400, CHOOSE, { errors: [{ field, message: CHOOSE }] });
    }
    if (choice !== saved) {
      await call(changePreference, {
        body: { purpose, channel, state: choice, privacyNoticeVersion: PRIVACY_NOTICE_VERSION },
      });
      setSaved(choice);
    }
    setStatus(`Saved. ${label}: ${choice === 'given' ? 'yes' : 'no'}.`);
  });

  return (
    <form
      noValidate
      onSubmit={form.onSubmit}
      className="flex flex-col gap-4 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6"
    >
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <RadioGroup
        id={field}
        name={field}
        legend={label}
        hint={
          saved === 'withdrawn'
            ? 'You turned this off. You can turn it back on here.'
            : 'You can change your choice at any time.'
        }
        options={options}
        value={choice}
        onValueChange={setChoice}
        error={form.errorFor(field)}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={form.pending || undefined}
          className="w-full sm:w-auto"
        >
          {form.pending ? 'Saving…' : 'Save my choice'}
        </Button>
      </div>
      <p role="status" className="min-h-6 text-body font-medium text-ink">
        {status}
      </p>
    </form>
  );
}

type Read =
  | { status: 'loading' }
  | { status: 'ready'; preferences: Preference[] }
  | { status: 'failed'; message: string };

const FAILED = 'We could not load your choices. Check that you are online, then try again.';

/** The page for the "How we contact you" address. The portal wraps it in its sign-in check. */
export default function PreferencesPage() {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    call(getPreferences, {}).then(
      ({ preferences }) => {
        if (current) setRead({ status: 'ready', preferences });
      },
      (error: unknown) => {
        if (current) {
          const limited = error instanceof ProblemError && error.status === 429;
          setRead({ status: 'failed', message: limited ? error.message : FAILED });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4 sm:py-10">
      <div className="flex flex-col gap-4">
        <PageHeading className="text-3xl sm:text-4xl">How we contact you</PageHeading>
        <p className="max-w-prose text-lg text-ink">
          {read.status === 'failed'
            ? read.message
            : 'Choose what you want to hear from us. Nothing changes until you press the save button.'}
        </p>
      </div>
      {read.status === 'loading' && <LoadingState label="Loading your choices" />}
      {read.status === 'failed' && (
        <div>
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => {
              setRead({ status: 'loading' });
              setAttempt((count) => count + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {read.status === 'ready' &&
        read.preferences.map((preference) => (
          <Row key={`${preference.purpose}-${preference.channel}`} preference={preference} />
        ))}
    </div>
  );
}
