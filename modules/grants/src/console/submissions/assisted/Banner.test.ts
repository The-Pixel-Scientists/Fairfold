// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { bannerText } from './Banner.tsx';

describe('the assisted banner', () => {
  it('names the organisation and the applicant, and says they will be told', () => {
    expect(bannerText({ organisation: 'Riverside Youth Trust', contact: 'Sam Patel' })).toBe(
      'You are filling in this application for Riverside Youth Trust on behalf of Sam Patel. They will be told you submitted it.',
    );
  });

  it('still names the organisation when the applicant has no name on record', () => {
    expect(bannerText({ organisation: 'Riverside Youth Trust', contact: null })).toBe(
      'You are filling in this application for Riverside Youth Trust. They will be told you submitted it.',
    );
  });
});
