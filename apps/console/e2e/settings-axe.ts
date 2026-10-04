// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the settings axe specs share: every screen and state is checked at
// desktop width, 320 px wide and 200% zoom (auth-axe.ts), in the standard
// look and in a saved custom look.

import { test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { expectNoHorizontalScroll, expectNoViolations, widths } from './auth-axe.ts';
import { custom, standard, stubSettings } from './settings-api.ts';
import type { Funder, SettingsStub } from './settings-api.ts';

export const looks = [
  { name: 'the standard look', funder: standard },
  { name: 'a saved custom look', funder: custom },
] as const;

export interface SettingsState {
  name: string;
  /** Sets the API's answers for this state, from the funder in this look. */
  stub?: (page: Page, funder: Funder) => Promise<SettingsStub>;
  /** Opens the screen and gets it into the state, and waits until it is showing. */
  open: (page: Page, stub: SettingsStub) => Promise<void>;
}

export function checkSettingsStates(states: readonly SettingsState[]): void {
  for (const look of looks) {
    for (const width of widths) {
      test.describe(`in ${look.name} at ${width.name}`, () => {
        test.use({ viewport: width.viewport, deviceScaleFactor: width.deviceScaleFactor });

        for (const state of states) {
          test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
            const stub = await (state.stub ?? stubSettings)(page, look.funder);
            await state.open(page, stub);

            await expectNoViolations(page);
            await expectNoHorizontalScroll(page);
          });
        }
      });
    }
  }
}
