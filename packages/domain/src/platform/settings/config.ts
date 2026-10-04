// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a settings change records in `app.config_version` (architecture rule
// 10). The entity type names what changed and the entity id is the id of the
// row changed: `app.tenant`, `app.tenant_theme` or `app.tenant_module`. The
// diff lists each changed field with its old and new values; the logo is
// recorded by its type and SHA-256 digest, never its bytes.

import { z } from 'zod';

import { logoTypes, presets } from '../theme.ts';

export const configEntityTypes = ['platform.tenant', 'platform.theme', 'platform.module'] as const;

export type ConfigEntityType = (typeof configEntityTypes)[number];

function change<const F extends string, V extends z.ZodType>(field: F, value: V) {
  return z.strictObject({ field: z.literal(field), from: value, to: value });
}

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/);
const logo = z
  .strictObject({ type: z.enum(logoTypes), sha256: z.string().regex(/^[0-9a-f]{64}$/) })
  .nullable();

export const configDiffSchemas = {
  'platform.tenant': z
    .array(
      z.discriminatedUnion('field', [
        change('name', z.string()),
        change('timeZone', z.string()),
        change('fiscalYearStartMonth', z.int().min(1).max(12)),
      ]),
    )
    .min(1),
  'platform.theme': z
    .array(
      z.discriminatedUnion('field', [
        change('brandColour', hexColour),
        change('preset', z.enum(presets)),
        change('logo', logo),
      ]),
    )
    .min(1),
  'platform.module': z.tuple([change('enabled', z.boolean())]),
} as const satisfies Record<ConfigEntityType, z.ZodType>;

export type ConfigDiff<T extends ConfigEntityType> = z.infer<(typeof configDiffSchemas)[T]>;
