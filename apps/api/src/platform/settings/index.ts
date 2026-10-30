// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The settings, theme and module routes (S03-04), matched with their
// contracts. The logo routes are in logo.ts.

import {
  getSettings,
  getTheme,
  listModules,
  removeLogo,
  removeThemeTokens,
  switchModule,
  updateSettings,
  updateTheme,
  updateThemeTokens,
  uploadLogo,
} from '@pixel-scientists/domain/platform/settings';

import { route, type Route } from '../../routes/register.ts';
import { LOGO_BODY_LIMIT_BYTES, removeLogoHandler, uploadLogoHandler } from './logo.ts';
import { listModulesHandler, switchModuleHandler } from './modules.ts';
import { getSettingsHandler, updateSettingsHandler } from './tenant.ts';
import { getThemeHandler, updateThemeHandler } from './theme.ts';
import { removeThemeTokensHandler, updateThemeTokensHandler } from './tokens.ts';

export const settingsRoutes: readonly Route[] = [
  route(getSettings, getSettingsHandler),
  route(updateSettings, updateSettingsHandler),
  route(getTheme, getThemeHandler),
  route(updateTheme, updateThemeHandler),
  route(updateThemeTokens, updateThemeTokensHandler),
  route(removeThemeTokens, removeThemeTokensHandler),
  route(uploadLogo, uploadLogoHandler, { bodyLimit: LOGO_BODY_LIMIT_BYTES }),
  route(removeLogo, removeLogoHandler),
  route(listModules, listModulesHandler),
  route(switchModule, switchModuleHandler),
];
