// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What publishing a form records in `app.config_version` (architecture rule
// 10). A round's form has one history: each publication writes a version
// whose entity id is the round's id, with the changes from the previous
// published version, or from nothing for the first. Changes follow the
// programme set-up's format, `{ "changes": [{ path, from, to }] }`, with
// paths by section and field id:
//   - `sections.<section id>.<key>` for a section's title, introduction and
//     conditions, its position from 1, and `fields`, its field ids in order;
//   - `fields.<field id>.<key>` for each of a field's values.
// A list or object, such as options or conditions, is recorded as its JSON
// text with each object's keys sorted, so a definition read back from jsonb,
// which reorders keys, records the same text as the one that was parsed. Null stands for a value that was not there. A publication that
// changes nothing still writes a version, with no changes.

import { MAX_FIELDS, type FormDefinition } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { configChangeSchema, type ConfigValue } from '../programme/config.ts';

export const formConfigEntityType = 'grants.form_version';

export const formPathPattern =
  /^(?:sections\.s_[a-z0-9]{1,32}|fields\.f_[a-z0-9]{1,32})\.[a-z][A-Za-z]*$/;

/**
 * The most changes one diff holds: every value of two forms at the limits,
 * with no id in common. A section records five values, a field at most twelve.
 */
export const MAX_FORM_CHANGES = 2 * (50 * 5 + MAX_FIELDS * 12);

export const formVersionDiffSchema = z.strictObject({
  changes: z
    .array(configChangeSchema.extend({ path: z.string().max(80).regex(formPathPattern) }))
    .max(MAX_FORM_CHANGES),
});

export type FormVersionDiff = z.infer<typeof formVersionDiffSchema>;

/** A copy with every object's keys in order, so stored text, such as jsonb's, compares equal. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
  );
}

function recorded(value: unknown): ConfigValue {
  if (value === undefined) return null;
  return typeof value === 'object' && value !== null
    ? JSON.stringify(sortedKeys(value))
    : (value as ConfigValue);
}

function valuesOf(definition: FormDefinition): Map<string, ConfigValue> {
  const values = new Map<string, ConfigValue>();
  const record = (prefix: string, object: object) => {
    for (const [key, value] of Object.entries(object))
      values.set(`${prefix}.${key}`, recorded(value));
  };
  definition.sections.forEach(({ id, fields, ...section }, index) => {
    record(`sections.${id}`, {
      ...section,
      position: index + 1,
      fields: fields.map((field) => field.id).join(','),
    });
    for (const { id: fieldId, ...field } of fields) record(`fields.${fieldId}`, field);
  });
  return values;
}

/** The changes from the previous published definition, or from nothing, to the one being published. */
export function formDiff(before: FormDefinition | null, after: FormDefinition): FormVersionDiff {
  const from = before === null ? new Map<string, ConfigValue>() : valuesOf(before);
  const to = valuesOf(after);
  const changes = [...new Set([...from.keys(), ...to.keys()])]
    .map((path) => ({ path, from: from.get(path) ?? null, to: to.get(path) ?? null }))
    .filter((change) => change.from !== change.to);
  return { changes };
}
