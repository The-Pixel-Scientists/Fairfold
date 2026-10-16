// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings, theme and module routes for tenant admins, and the public tenant
// routes the portal reads before sign-in (ADR 0016, ADR 0019). The public
// routes have no permission or scope: the API answers them only through
// ADR 0019's public functions, with no tenant set, and answers 404 alike for
// an unknown, suspended or malformed slug.

import { z } from 'zod';

import { defineRoute } from '../../api/route.ts';
import { slugSchema } from '../tenant.ts';
import {
  logoUploadSchema,
  moduleListSchema,
  moduleStateSchema,
  publicTenantSchema,
  settingsResponseSchema,
  settingsSchema,
  themeChangeSchema,
  themeSettingsSchema,
  themeTokensChangeSchema,
} from './schemas.ts';

const manage = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
} as const;

export const getSettings = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/settings',
  summary: "Read the tenant's name, time zone and fiscal year",
  responses: { 200: settingsResponseSchema },
});

export const updateSettings = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/settings',
  summary: "Change the tenant's name, time zone and fiscal year",
  body: settingsSchema,
  responses: { 200: settingsResponseSchema },
});

export const getTheme = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/settings/theme',
  summary: "Read the tenant's look: brand colour, preset, logo and any tokens of its own",
  responses: { 200: themeSettingsSchema },
});

export const updateTheme = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/settings/theme',
  summary: "Save the tenant's brand colour and preset, clearing any tokens of its own",
  body: themeChangeSchema,
  responses: { 200: themeSettingsSchema },
});

export const updateThemeTokens = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/settings/theme/tokens',
  summary: "Save the tenant's own design tokens, used in place of its preset",
  body: themeTokensChangeSchema,
  responses: { 200: themeSettingsSchema },
});

export const removeThemeTokens = defineRoute({
  ...manage,
  method: 'DELETE',
  path: '/console/settings/theme/tokens',
  summary: "Remove the tenant's own design tokens and go back to its preset",
  responses: { 200: themeSettingsSchema },
});

export const uploadLogo = defineRoute({
  ...manage,
  method: 'PUT',
  path: '/console/settings/theme/logo',
  summary: "Upload the tenant's logo, a PNG or WebP image as base64",
  body: logoUploadSchema,
  responses: { 200: themeSettingsSchema },
});

export const removeLogo = defineRoute({
  ...manage,
  method: 'DELETE',
  path: '/console/settings/theme/logo',
  summary: "Remove the tenant's logo",
  responses: { 200: themeSettingsSchema },
});

export const listModules = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/settings/modules',
  summary: 'List the modules a tenant can switch on or off',
  responses: { 200: moduleListSchema },
});

export const switchModule = defineRoute({
  ...manage,
  method: 'PATCH',
  path: '/console/settings/modules',
  summary: 'Switch a module on or off',
  body: moduleStateSchema,
  responses: { 200: moduleListSchema },
});

const publicTenant = {
  audience: 'public',
  module: 'platform',
  permission: null,
  scope: null,
  method: 'GET',
  params: z.strictObject({ slug: slugSchema }),
} as const;

export const getPublicTenant = defineRoute({
  ...publicTenant,
  path: '/public/tenants/:slug',
  summary: "Read an active tenant's name and theme tokens",
  responses: { 200: publicTenantSchema },
});

export const getThemeCss = defineRoute({
  ...publicTenant,
  path: '/public/tenants/:slug/theme.css',
  summary: "Read an active tenant's theme as a stylesheet",
  responses: { 200: { raw: ['text/css'] } },
});

export const getLogo = defineRoute({
  ...publicTenant,
  path: '/public/tenants/:slug/logo',
  summary: "Read an active tenant's logo",
  responses: { 200: { raw: ['image/png', 'image/webp'] } },
});

export const settingsRoutes = {
  getSettings,
  updateSettings,
  getTheme,
  updateTheme,
  updateThemeTokens,
  removeThemeTokens,
  uploadLogo,
  removeLogo,
  listModules,
  switchModule,
} as const;

/** Every route with no permission here, for the API's checks and review. */
export const publicTenantRoutes = { getPublicTenant, getThemeCss, getLogo } as const;
