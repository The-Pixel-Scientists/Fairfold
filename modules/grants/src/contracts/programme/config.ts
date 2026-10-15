// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a programme set-up change records in `app.config_version`
// (architecture rule 10). A programme's versions cover its own fields and
// its email templates; a round's cover its own fields, its stages and their
// rubrics, so each has one history. The entity id is the programme's or the
// round's id. A diff lists each changed value by its path, with its old and
// new values: `budget.amountMinor`, `stages.<stage id>.name`,
// `stages.<stage id>.criteria.<criterion id>.weight` or
// `emailTemplates.accepted.subject`. Null stands for a value that was not
// there, so an added stage's values go from null and a removed one's to null.
// The table only takes a JSON object, so `diff` holds `{ "changes": [...] }`
// (configVersionDiffSchema), never the bare list.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { MAX_CRITERIA, MAX_STAGES } from './inputs.ts';

export const grantsConfigEntityTypes = ['grants.programme', 'grants.round'] as const;

export type GrantsConfigEntityType = (typeof grantsConfigEntityTypes)[number];

/** A field name, then field names or the ids of stages and criteria. */
export const configPathPattern =
  /^[a-z][A-Za-z]*(?:\.(?:[a-z][A-Za-z]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))*$/;

const configValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type ConfigValue = z.infer<typeof configValueSchema>;

export const configChangeSchema = z.strictObject({
  path: z.string().max(200).regex(configPathPattern),
  from: configValueSchema,
  to: configValueSchema,
});

/**
 * The most changes one diff holds: every value of a round with its largest
 * stages and rubrics, in both versions. A stage has two values of its own and
 * a criterion has fewer than eight; the 50 covers the programme's or round's
 * own fields and templates. A valid set-up change never reaches it.
 */
export const MAX_CONFIG_CHANGES = 2 * MAX_STAGES * (2 + MAX_CRITERIA * 8) + 50;

export const configDiffSchema = z.array(configChangeSchema).min(1).max(MAX_CONFIG_CHANGES);

export type ConfigDiff = z.infer<typeof configDiffSchema>;

/** What `app.config_version.diff` stores. */
export const configVersionDiffSchema = z.strictObject({ changes: configDiffSchema });

export type ConfigVersionDiff = z.infer<typeof configVersionDiffSchema>;

/** An object as its versions are compared: values, and objects keyed by field name or id. */
export interface ConfigObject {
  readonly [key: string]: ConfigValue | ConfigObject;
}

function flatten(object: ConfigObject, prefix: string, into: Map<string, ConfigValue>) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') flatten(value, path, into);
    else into.set(path, value);
  }
  return into;
}

/**
 * The changes from one version of an object to the next, or none. `before`
 * is null for a new object. Throws on a key that is not a field name or an
 * id, such as a list position, which would not identify the same thing in
 * both versions.
 */
export function configDiff(before: ConfigObject | null, after: ConfigObject): ConfigDiff {
  const from = flatten(before ?? {}, '', new Map());
  const to = flatten(after, '', new Map());
  const changes: ConfigDiff = [];
  for (const path of new Set([...from.keys(), ...to.keys()])) {
    if (!configPathPattern.test(path)) throw new Error(`${path} is not a configuration path.`);
    const change = { path, from: from.get(path) ?? null, to: to.get(path) ?? null };
    if (change.from !== change.to) changes.push(change);
  }
  return changes;
}

/** One saved change. The author is a staff member, named from their person record when they have one. */
export const configVersionSchema = z.object({
  version: z.int(),
  createdAt: z.iso.datetime(),
  author: z.object({ membershipId: idSchema, name: z.string().nullable() }),
  ...configVersionDiffSchema.shape,
});

export type ConfigVersion = z.infer<typeof configVersionSchema>;

/** Newest first. */
export const configHistorySchema = z.object({ versions: z.array(configVersionSchema) });

export type ConfigHistory = z.infer<typeof configHistorySchema>;
