// SPDX-License-Identifier: AGPL-3.0-or-later

import { consentChannels, consentPurposes } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { preferenceLabel } from './wording.ts';

describe('preferenceLabel', () => {
  it('says what the person would receive and how', () => {
    expect(preferenceLabel('future_funding', 'email')).toBe(
      'News about future funding rounds, by email',
    );
  });

  it('has words for every purpose and channel', () => {
    for (const purpose of consentPurposes) {
      for (const channel of consentChannels) {
        expect(preferenceLabel(purpose, channel)).toMatch(/^[A-Z].+, by .+/);
      }
    }
  });
});
