// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings, theme, module and public tenant contracts: the
// `/platform/settings` subpath of the domain package.

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
  settingsRoutes,
  switchModule,
  updateSettings,
  updateTheme,
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
  themeTokensSchema,
  timeZones,
  timeZoneSchema,
  type PublicTenant,
  type Settings,
  type ThemeTokens,
} from './schemas.ts';
export { presetTokens, themeCss } from './theme-css.ts';
