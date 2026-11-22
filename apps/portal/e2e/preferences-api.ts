// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the preferences specs share: the route's key, and an answer in the shape
// of the party contract. Synthetic data only.

export const PREFERENCES = '/portal/profile/preferences';
export const LABEL = 'News about future funding rounds, by email';

export const choices = (state: 'given' | 'withdrawn' | null) => ({
  status: 200,
  body: {
    preferences: [
      {
        purpose: 'future_funding',
        channel: 'email',
        state,
        recordedAt: state === null ? null : '2027-01-04T10:00:00.000Z',
      },
    ],
  },
});
