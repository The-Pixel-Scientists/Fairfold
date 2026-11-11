// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the subject access and erasure screens: the API's keys and
// answers for one synthetic person. Not part of the app.

import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

import { stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { openConsole } from '../../testing/render.tsx';
import { SESSION, administrator, ok } from '../settings/testing.ts';

export const PARTY = '3f1e5a7b-9c2d-4e6f-8a1b-0c9d8e7f6a5b';
export const REQUEST = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
export const FILE = '5d1c2b9a-3e4f-4a6b-8c7d-9e0f1a2b3c4d';

export const SEARCH = 'POST /console/crm/search';
export const PERSON = `GET /console/crm/people/${PARTY}`;
export const REQUEST_EXPORT = 'POST /console/subject-access-requests';
export const READ_EXPORT = `GET /console/subject-access-requests/${REQUEST}`;
export const REQUEST_ERASURE = 'POST /console/erasure-requests';
export const READ_ERASURE = `GET /console/erasure-requests/${REQUEST}`;
export const STEP_UP = 'POST /auth/step-up';

export const person = ok({
  state: 'current',
  status: 'active',
  person: {
    id: PARTY,
    givenName: 'Amara',
    familyName: 'Okafor',
    email: 'amara@example.org',
    phone: null,
    organisations: [],
    consents: [],
  },
  lists: [],
  externalReferences: [],
  timeline: { interactions: 0, latestAt: null },
});

export type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

export function open(path: string, more: Handlers = {}) {
  const sent = stubApi({ [SESSION]: ok(administrator()), [PERSON]: person, ...more });
  openConsole(`/northfield${path}`);
  return sent;
}

export async function confirmItIsYou(user: ReturnType<typeof userEvent.setup>) {
  const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
  await user.type(step.getByLabelText('Password'), 'correct horse battery');
  await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
  await user.click(step.getByRole('button', { name: 'Confirm it is you' }));
}

/** Nothing about the person is in the title, storage or history state. */
export function expectNothingKept(): void {
  const stored = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? ''));
  const kept = [
    document.title,
    JSON.stringify(stored(localStorage)),
    JSON.stringify(stored(sessionStorage)),
    JSON.stringify(window.history.state),
  ].join(' ');
  expect(kept).not.toMatch(/Amara|Okafor|example\.org/);
}
