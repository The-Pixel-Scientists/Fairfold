// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading a Zod schema as JSON Schema, for the route rules in
// schema-rules.ts. A schema that cannot convert on the side asked for gives
// undefined, and the rules refuse it: custom and recursive schemas never
// convert, and a transform converts on its output side only when a schema
// for its result follows it.

import { z } from 'zod';

export type JsonSchema = Readonly<Record<string, unknown>>;

const TYPED = ['type', 'anyOf', 'oneOf', 'allOf', 'const', 'enum', 'not', '$ref'];
const SCALARS = ['string', 'number', 'integer', 'boolean'];

export function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema | undefined {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'throw', cycles: 'throw' });
  } catch {
    return undefined;
  }
}

/** Every schema inside a JSON Schema document, the root included. */
export function* schemaNodes(node: unknown): Generator<JsonSchema> {
  if (!isObject(node)) return;
  yield node;
  for (const key of ['items', 'additionalProperties', 'propertyNames', 'contains']) {
    yield* schemaNodes(node[key]);
  }
  for (const key of ['prefixItems', 'anyOf', 'oneOf', 'allOf']) {
    for (const child of list(node[key])) yield* schemaNodes(child);
  }
  for (const key of ['properties', 'patternProperties', '$defs']) {
    const map = node[key];
    if (isObject(map)) for (const child of Object.values(map)) yield* schemaNodes(child);
  }
}

/** The keys an object names: its properties, and the keys a record lists. */
export function keysOf(node: JsonSchema): string[] {
  const keys = isObject(node['properties']) ? Object.keys(node['properties']) : [];
  const names = node['propertyNames'];
  if (isObject(names)) {
    for (const key of [...list(names['enum']), names['const']]) {
      if (typeof key === 'string') keys.push(key);
    }
  }
  return keys;
}

function refusesAll(pattern: unknown, probes: readonly string[]): boolean {
  try {
    // The pattern comes from a route contract's own schema, never from a request.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    const regex = new RegExp(String(pattern));
    return !probes.some((probe) => regex.test(probe));
  } catch {
    return false;
  }
}

/**
 * An object or record that accepts keys it neither names nor checks. A
 * record's keys count as checked by a list, a format, or a pattern that
 * refuses every probe key.
 */
export function isOpenObject(node: JsonSchema, probes: readonly string[]): boolean {
  if (node['type'] !== 'object' || node['additionalProperties'] === false) return false;
  const names = node['propertyNames'];
  if (!isObject(names)) return true;
  if ('enum' in names || 'const' in names || 'format' in names) return false;
  return !('pattern' in names && refusesAll(names['pattern'], probes));
}

/** Says nothing about its value, as `z.any()` and `z.unknown()` do. */
export function isUntyped(node: JsonSchema): boolean {
  return !TYPED.some((key) => key in node);
}

/** The JSON types a node admits, through `type`, `const`, `enum` and its unions. */
function typesOf(node: JsonSchema): Set<string> {
  const types = new Set<string>();
  for (const type of [node['type']].flat()) if (typeof type === 'string') types.add(type);
  const values = 'const' in node ? [node['const']] : list(node['enum']);
  for (const value of values) {
    types.add(value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
  }
  for (const branch of [...list(node['anyOf']), ...list(node['oneOf'])]) {
    if (isObject(branch)) for (const type of typesOf(branch)) types.add(type);
  }
  return types;
}

/** A union of objects, lists and plain values: JSON of any shape. */
export function isAnyShape(node: JsonSchema): boolean {
  const types = typesOf(node);
  return types.has('object') && types.has('array') && SCALARS.some((type) => types.has(type));
}
