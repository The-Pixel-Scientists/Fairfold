// SPDX-License-Identifier: AGPL-3.0-or-later

import { getProfile, updateProfile } from '@pixel-scientists/party/contracts';
import type { Profile } from '@pixel-scientists/party/contracts';
import {
  ErrorSummary,
  FormField,
  Input,
  SummaryList,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import type { ChangeEvent } from 'react';

import { callApi } from '../api.ts';
import { SubmitButton } from '../auth/fields.tsx';
import { Screen } from '../auth/Screen.tsx';
import { HOME_PATH } from '../paths.ts';
import { useDraft } from './drafts.ts';
import { KeptNote, ReadPage, RestoredNotice, homeCrumb } from './parts.tsx';
import { savedPath } from './Saved.tsx';
import { useRead } from './useRead.ts';

const FIELDS = ['givenName', 'familyName', 'phone'] as const;
const TITLE = 'Your details';
const breadcrumbs = [homeCrumb, { label: TITLE }];

interface Values {
  givenName: string;
  familyName: string;
  phone: string;
}

const readProfile = () => callApi(getProfile, {});

function valuesOf(profile: Profile): Values {
  return {
    givenName: profile.givenName ?? '',
    familyName: profile.familyName ?? '',
    phone: profile.phone ?? '',
  };
}

function ProfileForm({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const draft = useDraft('profile', valuesOf(profile));
  const { values } = draft;
  const form = useSubmit(FIELDS, async () => {
    await callApi(updateProfile, { body: values });
    draft.discard();
    navigate(savedPath(HOME_PATH, 'details'));
  });
  const set = (field: keyof Values) => (event: ChangeEvent<HTMLInputElement>) => {
    draft.change({ ...values, [field]: event.currentTarget.value });
  };

  return (
    <>
      <div className="flex max-w-md flex-col gap-2">
        <SummaryList
          items={[
            {
              term: 'Email address',
              value: <span className="[overflow-wrap:anywhere]">{profile.email}</span>,
            },
          ]}
        />
        <p className="text-body text-muted">
          This is the address you sign in with. You cannot change it here.
        </p>
      </div>
      {draft.restored && <RestoredNotice />}
      <form noValidate onSubmit={form.onSubmit} className="flex max-w-md flex-col gap-6">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField id="givenName" label="First name" error={form.errorFor('givenName')}>
          <Input
            name="givenName"
            autoComplete="given-name"
            value={values.givenName}
            onChange={set('givenName')}
          />
        </FormField>
        <FormField id="familyName" label="Last name" error={form.errorFor('familyName')}>
          <Input
            name="familyName"
            autoComplete="family-name"
            value={values.familyName}
            onChange={set('familyName')}
          />
        </FormField>
        <FormField
          id="phone"
          label="Phone number"
          optional
          hint="For example, 01632 960 001."
          error={form.errorFor('phone')}
        >
          <Input
            name="phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={set('phone')}
          />
        </FormField>
        <SubmitButton pending={form.pending} label="Save details" pendingLabel="Saving…" />
        <KeptNote />
      </form>
    </>
  );
}

function Details() {
  const { read, retry } = useRead(readProfile);
  return (
    <ReadPage
      title={TITLE}
      breadcrumbs={breadcrumbs}
      intro={<p>Tell us your name. Add a phone number if you want us to be able to call you.</p>}
      read={read}
      retry={retry}
    >
      {(profile) => <ProfileForm profile={profile} />}
    </ReadPage>
  );
}

export default function ProfilePage() {
  return (
    <Screen kind="applicant">
      <Details />
    </Screen>
  );
}
