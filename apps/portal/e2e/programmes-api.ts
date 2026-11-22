// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the programmes specs share: a synthetic open round, as the public route
// sends it, and the keys the stub answers to.

export const ROUND_ID = '8a1f3c5e-2b4d-4e6a-9c7b-0d1e2f3a4b5c';
export const OTHER_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

export const round = {
  id: ROUND_ID,
  title: 'Round 1',
  programme: { title: 'Programme A', summary: 'Grants for community groups.' },
  opensAt: '2027-01-04T09:00:00.000Z',
  closesAt: '2027-01-14T17:00:00.000Z',
  timeZone: 'Europe/London',
  awardMinimum: { amountMinor: 500_000, currency: 'GBP' },
  awardMaximum: { amountMinor: 2_500_000, currency: 'GBP' },
  eligibility: [
    {
      label: 'Is your organisation a registered charity?',
      explanation: 'This programme is open to registered charities only.',
    },
  ],
};

export const LIST = 'GET /public/tenants/northfield/rounds';
export const ONE = `GET /public/tenants/northfield/rounds/${ROUND_ID}`;
