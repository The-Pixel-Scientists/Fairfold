// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isReviewerPath } from './reviewerPath.ts';

describe('the reviewer shell', () => {
  it.each(['/reviews', '/reviews/', '/reviews/NF-CG-0398', '/reviews/NF-CG-0398/'])(
    'is used at %s',
    (pathname) => {
      expect(isReviewerPath(pathname)).toBe(true);
    },
  );

  it.each(['/reviews/spread', '/reviews/spread/', '/submissions', '/', '/organisations/'])(
    'is not used at %s',
    (pathname) => {
      expect(isReviewerPath(pathname)).toBe(false);
    },
  );
});
