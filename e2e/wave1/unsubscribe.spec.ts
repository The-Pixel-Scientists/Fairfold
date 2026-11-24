// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The unsubscribe link and the contact preferences (ADR 0033, RFC 8058), left
// for later by the batch 14 journey.
//
//  - A token that was not signed by the server changes nothing and gets one
//    problem that repeats nothing, on the page's read and on the mail client's
//    one-click POST. A scanner that follows the link does no harm.
//  - An applicant changes their own contact preference and nobody else's:
//    repeating a choice records nothing, and a body that names a person is
//    refused.
//
// A valid token cannot be made here: it is signed with TPS_UNSUBSCRIBE_SECRET,
// which the spec does not read, and no marketing email is sent on the stack yet.
// The journey from a real email, "unsubscribes once and answers already
// unsubscribed after", waits for the sender (S12-63) and the stack's secret.

import { request } from '@playwright/test';

import type { Api } from '../support/api.ts';
import { consoleOrigin } from '../support/env.ts';
import {
  ABSENT,
  jsonOf,
  call,
  echoesNothing,
  expect,
  onWave1,
  signInApplicant,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
/** Shaped like a token (base64url, 43 characters) and signed by no one. */
const UNSIGNED = 'dW5zaWduZWQtdG9rZW4tZm9yLXRoZS10ZXN0LW9ubHktMDAwMA';

interface Preferences {
  preferences: {
    purpose: string;
    channel: string;
    state: 'given' | 'withdrawn' | null;
    recordedAt: string | null;
  }[];
}

let first: Api;
let second: Api;

const preference = (answer: Preferences) =>
  answer.preferences.find(
    ({ purpose, channel }) => purpose === 'future_funding' && channel === 'email',
  );

test.describe('unsubscribe and contact preferences', () => {
  test.beforeAll(async () => {
    first = await signInApplicant(slug, 0);
    second = await signInApplicant(slug, 1);
  });

  test.afterAll(async () => {
    await Promise.all([first.dispose(), second.dispose()]);
  });

  test('an unsigned token changes nothing: the read and the one-click POST answer one problem that repeats nothing', async () => {
    const visitor = await request.newContext({ baseURL: consoleOrigin });
    try {
      const url = `/api/public/unsubscribe?token=${UNSIGNED}`;
      const read = await visitor.get(url, { failOnStatusCode: false });
      const post = await visitor.post(url, {
        form: { 'List-Unsubscribe': 'One-Click' },
        failOnStatusCode: false,
      });
      for (const answer of [read, post]) {
        expect(answer.status()).toBe(404);
        expect(answer.headers()['content-type']).toContain('application/problem+json');
        expect(await answer.text()).not.toContain(UNSIGNED);
        expect(answer.headers()['set-cookie']).toBeUndefined();
      }
      const malformed = await visitor.get('/api/public/unsubscribe?token=x', {
        failOnStatusCode: false,
      });
      expect([400, 404]).toContain(malformed.status());
      expect(await malformed.text()).not.toContain('token=x');
    } finally {
      await visitor.dispose();
    }
  });

  test('an applicant changes their own preference once, a repeat records nothing, and nobody else’s changes', async () => {
    const untouched = preference(
      await jsonOf<Preferences>(call(second, 'GET', '/portal/profile/preferences')),
    );
    const choice = {
      purpose: 'future_funding',
      channel: 'email',
      privacyNoticeVersion: 'notice-1',
    };

    const given = preference(
      await jsonOf<Preferences>(
        call(first, 'PUT', '/portal/profile/preferences', { ...choice, state: 'given' }),
      ),
    );
    expect(given?.state).toBe('given');
    const repeated = preference(
      await jsonOf<Preferences>(
        call(first, 'PUT', '/portal/profile/preferences', { ...choice, state: 'given' }),
      ),
    );
    expect(repeated?.recordedAt).toBe(given?.recordedAt);

    const withdrawn = preference(
      await jsonOf<Preferences>(
        call(first, 'PUT', '/portal/profile/preferences', { ...choice, state: 'withdrawn' }),
      ),
    );
    expect(withdrawn?.state).toBe('withdrawn');
    expect(
      preference(await jsonOf<Preferences>(call(second, 'GET', '/portal/profile/preferences'))),
    ).toEqual(untouched);
  });

  test('a preference that names a person is refused', async () => {
    for (const key of ['personId', 'tenantId', 'membershipId']) {
      const answer = await call(first, 'PUT', '/portal/profile/preferences', {
        purpose: 'future_funding',
        channel: 'email',
        state: 'given',
        privacyNoticeVersion: 'notice-1',
        [key]: ABSENT,
      });
      expect(answer.status, key).toBe(400);
      expect(echoesNothing(answer, ABSENT)).toBe(true);
    }
  });

  test.fixme('a signed token from a marketing email unsubscribes once and answers already unsubscribed after', () => {
    // Needs a marketing email on the stack (S12-63's sender) and its TPS_UNSUBSCRIBE_SECRET in the stack settings (lead).
  });
});
