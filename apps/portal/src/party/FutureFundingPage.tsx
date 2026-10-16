// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { consentStateSchema, getProfile, recordConsent } from '@pixel-scientists/party/contracts';
import type { Consent, Profile } from '@pixel-scientists/party/contracts';
import { ErrorSummary, RadioGroup, useNavigate, useSubmit } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../api.ts';
import { SubmitButton } from '../auth/fields.tsx';
import { Screen } from '../auth/Screen.tsx';
import { useFunderName } from '../funder.tsx';
import { HOME_PATH } from '../paths.ts';
import { futureFundingChoice } from './consent.ts';
import { ReadPage, homeCrumb } from './parts.tsx';
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { savedPath } from './Saved.tsx';
import { useRead } from './useRead.ts';

const FIELD = 'future-funding';
const TITLE = 'Future funding';
const breadcrumbs = [homeCrumb, { label: TITLE }];
const CHOOSE = 'Choose yes or no.';

const options = [
  { value: 'given', label: 'Yes, email me about future funding' },
  { value: 'withdrawn', label: 'No, do not email me about future funding' },
];

const readProfile = () => callApi(getProfile, {});

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function Current({ consent }: { consent: Consent | undefined }) {
  return (
    <p className="max-w-prose text-lg text-ink">
      {consent === undefined
        ? 'You have not chosen yet.'
        : `Your choice now: ${consent.state === 'given' ? 'yes' : 'no'}. You made it on ${day.format(new Date(consent.recordedAt))}.`}
    </p>
  );
}

function ChoiceForm({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const current = futureFundingChoice(profile);
  const [choice, setChoice] = useState(current?.state ?? '');
  const form = useSubmit([FIELD], async () => {
    const state = consentStateSchema.safeParse(choice);
    if (!state.success) {
      throw new ProblemError(400, CHOOSE, { errors: [{ field: FIELD, message: CHOOSE }] });
    }
    if (state.data !== current?.state) {
      await callApi(recordConsent, {
        body: {
          purpose: 'future_funding',
          channel: 'email',
          state: state.data,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        },
      });
    }
    navigate(savedPath(HOME_PATH, 'future-funding'));
  });

  return (
    <>
      <Current consent={current} />
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <RadioGroup
          id={FIELD}
          name={FIELD}
          legend="Can we email you about future funding?"
          hint="We will only use your email address for this. You can change your choice at any time."
          options={options}
          value={choice}
          onValueChange={setChoice}
          error={form.errorFor(FIELD)}
        />
        <SubmitButton pending={form.pending} label="Save my choice" pendingLabel="Saving…" />
        <p className="text-body text-muted">
          When you save, we record your choice, the date and the privacy notice you saw. This is
          privacy notice version {PRIVACY_NOTICE_VERSION}.
        </p>
      </form>
    </>
  );
}

function Choice() {
  const { read, retry } = useRead(readProfile);
  const funder = useFunderName() ?? 'The funder';
  return (
    <ReadPage
      title={TITLE}
      breadcrumbs={breadcrumbs}
      intro={<p>{funder} may open new grants in the future. You can choose to hear about them.</p>}
      read={read}
      retry={retry}
    >
      {(profile) => <ChoiceForm profile={profile} />}
    </ReadPage>
  );
}

export default function FutureFundingPage() {
  return (
    <Screen kind="applicant">
      <Choice />
    </Screen>
  );
}
