// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the stylesheet specs: settings-api.ts, with a
// funder that can keep tokens of its own. Saving a preset clears them, as the
// API does, and `theme.css` follows whichever look is in use.

import { defaultTokens } from '@pixel-scientists/domain/platform';
import type { TokenSet } from '@pixel-scientists/domain/platform';
import { themeCss } from '@pixel-scientists/domain/platform/settings';
import type { Page } from '@playwright/test';

import type { Handler } from './auth-api.ts';
import { standard, stubSettings } from './settings-api.ts';
import type { Funder, SettingsStub } from './settings-api.ts';

/** The standard look with a green accent in the light scheme, which passes every contrast pair. */
export const greenTokens: TokenSet = {
  ...defaultTokens,
  light: { ...defaultTokens.light, colorAccent: '#0b5d3b' },
};

export interface StylesheetStub extends SettingsStub {
  /** The tokens saved, or null while the preset is in use. */
  tokens: TokenSet | null;
}

/**
 * A signed-in administrator of a funder that has `saved` tokens, or none.
 * `more` adds or replaces answers, keyed like `PUT /console/settings/theme/tokens`.
 */
export async function stubStylesheet(
  page: Page,
  funder: Funder = standard,
  saved: TokenSet | null = null,
  more: Record<string, Handler> = {},
): Promise<StylesheetStub> {
  const stylesheet: { tokens: TokenSet | null } = { tokens: saved };
  const look = () => {
    const { brandColour, preset, hasLogo } = stub.funder;
    return { status: 200, body: { brandColour, preset, hasLogo, tokens: stylesheet.tokens } };
  };
  const stub = await stubSettings(page, funder, {
    'GET /console/settings/theme': look,
    'PUT /console/settings/theme': (body) => {
      Object.assign(stub.funder, body);
      stylesheet.tokens = null;
      return look();
    },
    'PUT /console/settings/theme/tokens': (body) => {
      stylesheet.tokens = (body as { tokens: TokenSet }).tokens;
      return look();
    },
    'DELETE /console/settings/theme/tokens': () => {
      stylesheet.tokens = null;
      return look();
    },
    ...more,
  });

  // Routes added later answer first, so this takes theme.css from the preset's.
  await page.route('**/api/public/tenants/northfield/theme.css', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      body: themeCss(stylesheet.tokens === null ? stub.funder : { tokens: stylesheet.tokens }),
    }),
  );
  return {
    ...stub,
    get tokens() {
      return stylesheet.tokens;
    },
  };
}
