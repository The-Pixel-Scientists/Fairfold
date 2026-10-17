// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scenario `base`, which the demo uses: two tenants, each with an
// administrator, a programme manager and two reviewers. The names are
// fictional, from this fixed list, and every address ends in .example. No one
// has an authenticator yet: staff set up their app at their first sign-in.
// Eastmoor has its own brand colour, so the two tenants look different;
// Northfield keeps the default look.

import type { Scenario } from './scenario.ts';

export const base: Scenario = [
  {
    slug: 'northfield',
    name: 'Northfield Community Trust',
    staff: [
      ['Sunita', 'Rao', 'tenant_admin'],
      ['Ada', 'Morgan', 'programme_manager'],
      ['Owen', 'Hughes', 'reviewer'],
      ['Priya', 'Shah', 'reviewer'],
    ],
  },
  {
    slug: 'eastmoor',
    name: 'Eastmoor Foundation',
    theme: { brandColour: '#0b6e4f', preset: 'rounded' },
    staff: [
      ['Idris', 'Fenwick', 'tenant_admin'],
      ['Mei', 'Lindqvist', 'programme_manager'],
      ['Ruth', 'Okonjo', 'reviewer'],
      ['Callum', 'Drayton', 'reviewer'],
    ],
  },
];
