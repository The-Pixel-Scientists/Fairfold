// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's settings, theme and modules as the console and the public
// tenant routes read and change them (ADR 0016, ADR 0019).

import { z } from 'zod';

import { LOGO_MAX_BYTES } from '../logo.ts';
import { messages } from '../messages.ts';
import { switchableModuleIds } from '../modules.ts';
import { brandColourSchema, presets } from '../theme.ts';

/** The IANA time zones this runtime knows, for the settings screen's list. */
export const timeZones: readonly string[] = Intl.supportedValuesOf('timeZone');

export const timeZoneSchema = z
  .string()
  .refine((zone) => timeZones.includes(zone), { error: messages.chooseAllowedValue });

/**
 * A tenant's name, shown before sign-in and in emails. Control, format,
 * surrogate and line or paragraph separator characters could break a mail
 * header, hide text or reorder it, and Postgres refuses NUL. Every place
 * that sets a name, from settings to the operator command, uses this schema.
 */
export const tenantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]*$/u, { error: messages.tenantNameHidden })
  .refine((name) => /[\p{L}\p{N}]/u.test(name), { error: messages.tenantNameVisible });

export const settingsSchema = z.strictObject({
  name: tenantNameSchema,
  timeZone: timeZoneSchema,
  /** 1 is January. */
  fiscalYearStartMonth: z.int().min(1).max(12),
});

export type Settings = z.infer<typeof settingsSchema>;

/** What the API answers: stored values, which may predate a runtime's list of zones. */
export const settingsResponseSchema = z.object({
  name: z.string(),
  timeZone: z.string(),
  fiscalYearStartMonth: z.int(),
});

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/);

/** The theme tokens, and whether a logo exists. The logo itself has its own route. */
export const themeTokensSchema = z.object({
  brandColour: hexColour,
  preset: z.enum(presets),
  hasLogo: z.boolean(),
});

export type ThemeTokens = z.infer<typeof themeTokensSchema>;

export const themeChangeSchema = z.strictObject({
  brandColour: brandColourSchema,
  preset: z.enum(presets),
});

/** Base64 of at most LOGO_MAX_BYTES once decoded; the API checks the bytes with checkLogo(). */
const BASE64_MAX_LENGTH = 4 * Math.ceil(LOGO_MAX_BYTES / 3);

function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export const logoUploadSchema = z.strictObject({
  data: z
    .base64({ error: messages.logoUnreadable })
    .max(BASE64_MAX_LENGTH, { error: messages.logoTooLarge })
    .refine((data) => decodedLength(data) <= LOGO_MAX_BYTES, { error: messages.logoTooLarge }),
});

/** A switchable module and whether it is on; one with no stored state is on. Also the switch's body. */
export const moduleStateSchema = z.strictObject({
  module: z.enum(switchableModuleIds),
  enabled: z.boolean(),
});

export const moduleListSchema = z.object({ modules: z.array(moduleStateSchema) });

export const publicTenantSchema = z.object({ name: z.string(), theme: themeTokensSchema });

export type PublicTenant = z.infer<typeof publicTenantSchema>;
