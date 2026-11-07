// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a settings change records in `app.config_version` (architecture rule
// 10). The entity type names what changed and the entity id is the id of the
// row changed: `app.tenant`, `app.tenant_theme` or `app.tenant_module`. The
// diff lists each changed field with its old and new values; the logo is
// recorded by its type and SHA-256 digest, never its bytes. A funder's own
// tokens are diffed by token, with null where none was set (ADR 0046).
// Stored tokens that no longer pass the checks are cleared as a whole and
// recorded by a marker, never their values.
//
// The wave 1 tools' entries name their own rows. Where an entity holds items
// (checklist items, segment and report filters), a change is listed by path
// as grants' set-up is: a field name, then the item's id and its field. A
// diff holds configuration only, never personal data, so a filter is
// recorded by its field and operator and never the value it matches.

import { z } from 'zod';

import { logoTypes, presets } from '../theme.ts';
import { fonts, tokenPaths } from '../theme-tokens.ts';

export const configEntityTypes = [
  'platform.tenant',
  'platform.theme',
  'platform.module',
  'crm.segment',
  'assure.checklist',
  'forms.form',
  'insight.report_definition',
  'insight.disclosure_rule',
] as const;

export type ConfigEntityType = (typeof configEntityTypes)[number];

function change<const F extends string, V extends z.ZodType>(field: F, value: V) {
  return z.strictObject({ field: z.literal(field), from: value, to: value });
}

/** The changes at the paths `pattern` allows, each with its old and new values; null where there was none. */
function pathChanges(pattern: RegExp) {
  const value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
  return z
    .array(z.strictObject({ path: z.string().max(200).regex(pattern), from: value, to: value }))
    .min(1)
    .max(1000);
}

/** An item's or filter's stable id: a uuid or a form field id. */
const ITEM = String.raw`(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|f_[a-z0-9]{1,32})`;
const FILTER = String.raw`filters\.${ITEM}\.(?:field|operator)`;
const text = z.string().max(2000);

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/);
const tokenChange = z.strictObject({
  field: z.literal('token'),
  token: z.enum(tokenPaths),
  from: z.union([hexColour, z.number(), z.enum(Object.keys(fonts))]).nullable(),
  to: z.union([hexColour, z.number(), z.enum(Object.keys(fonts))]).nullable(),
});
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
        tokenChange,
        z.strictObject({ field: z.literal('tokens'), from: z.literal('unusable'), to: z.null() }),
      ]),
    )
    .min(1),
  'platform.module': z.tuple([change('enabled', z.boolean())]),
  'crm.segment': pathChanges(new RegExp(`^(?:name|description|${FILTER})$`)),
  'assure.checklist': pathChanges(
    new RegExp(`^(?:name|description|items\\.${ITEM}\\.(?:label|help|kind|required|position))$`),
  ),
  'forms.form': z
    .array(
      z.discriminatedUnion('field', [
        change('title', text),
        change('description', text.nullable()),
        change('respondents', z.enum(['signed_in', 'anonymous', 'both'])),
        change('opensAt', z.iso.datetime().nullable()),
        change('closesAt', z.iso.datetime().nullable()),
        // Changed only under forms.retention.manage, which takes step-up.
        change('retentionMonths', z.int().min(1)),
        change('confirmationMessage', text.nullable()),
      ]),
    )
    .min(1),
  'insight.report_definition': pathChanges(
    new RegExp(`^(?:name|description|source|measures\\.${ITEM}|groupBy\\.${ITEM}|${FILTER})$`),
  ),
  'insight.disclosure_rule': z
    .array(
      z.discriminatedUnion('field', [
        change('threshold', z.int().min(1)),
        change('minimumGroup', z.int().min(1)),
      ]),
    )
    .min(1),
} as const satisfies Record<ConfigEntityType, z.ZodType>;

export type ConfigDiff<T extends ConfigEntityType> = z.infer<(typeof configDiffSchemas)[T]>;
