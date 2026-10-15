// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings, theme, module and public tenant contracts: the
// `/platform/settings` subpath of the domain package.

import '../../jitless/index.ts';

export {
  configDiffSchemas,
  configEntityTypes,
  type ConfigDiff,
  type ConfigEntityType,
} from './config.ts';
export {
  getLogo,
  getPublicTenant,
  getSettings,
  getTheme,
  getThemeCss,
  listModules,
  publicTenantRoutes,
  removeLogo,
  removeThemeTokens,
  settingsRoutes,
  switchModule,
  updateSettings,
  updateTheme,
  updateThemeTokens,
  uploadLogo,
} from './routes.ts';
export {
  logoUploadSchema,
  moduleListSchema,
  moduleStateSchema,
  publicTenantSchema,
  settingsResponseSchema,
  settingsSchema,
  tenantNameSchema,
  themeChangeSchema,
  themeSettingsSchema,
  themeTokensChangeSchema,
  themeTokensSchema,
  timeZones,
  timeZoneSchema,
  type PublicTenant,
  type Settings,
  type ThemeSettings,
  type ThemeTokens,
} from './schemas.ts';
export {
  COMFORTABLE_SELECTOR,
  DARK_SCHEME_SELECTOR,
  presetTokens,
  themeCss,
  themeProperties,
  tokensFromPreset,
  type PresetLook,
  type ThemeLook,
} from './theme-css.ts';
export {
  parseTokenStylesheet,
  stylesheetMessages,
  TOKEN_STYLESHEET_MAX_BYTES,
  tokenStylesheet,
  type StylesheetProblem,
  type StylesheetResult,
} from './token-stylesheet.ts';
