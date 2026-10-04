// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for every form example in the component gallery and each of its
// states, at desktop width, at 320 px wide and at 200% zoom (ADR 0006). The
// console-gallery project runs them under the production content security
// policy.

import { test } from '../../../scripts/e2e/fixtures.ts';
import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';
import { galleryStates } from './forms-gallery-states.ts';

for (const width of widths) {
  test.describe(`at ${width.name}`, () => {
    test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

    for (const state of galleryStates) {
      test(`@a11y @gallery the form examples have no axe violations with ${state.name}`, async ({
        page,
      }) => {
        await state.open(page);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
