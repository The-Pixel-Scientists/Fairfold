// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { disclosureFloor } from '../contracts/index.ts';
import { applied } from './disclosure.ts';

describe('the applied rule', () => {
  it('is the platform floor for a tenant with no rule', () => {
    expect(applied(undefined)).toEqual({ version: null, ...disclosureFloor });
  });

  it('is the tenant’s own rule when it is above the floor, with its version', () => {
    expect(applied({ version: 3, threshold: 15, minimum_group: 40 })).toEqual({
      version: 3,
      threshold: 15,
      minimumGroup: 40,
    });
  });

  it('is never below the floor, even if a row somehow held less', () => {
    expect(applied({ version: 1, threshold: 3, minimum_group: 5 })).toEqual({
      version: 1,
      ...disclosureFloor,
    });
  });
});
