// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a job or event payload may hold (ADR 0009, ADR 0034): strict objects
// whose leaves are only ids, enums, integers and timestamps, so there is
// nowhere to put a name, email address, answer or free text. Anything the
// walker does not recognise is refused, so a new zod feature fails closed.

import { z } from 'zod';

export interface LeafProblem {
  /** Dotted keys from the root, '' for the root itself. Never a value. */
  readonly path: string;
  readonly reason: string;
}

interface Def {
  readonly type: string;
  readonly checks?: readonly { _zod: { def: { check: string; format?: string } } }[];
  readonly [key: string]: unknown;
}

type Schema = z.core.$ZodType;

const INTEGER_FORMATS = new Set(['safeint', 'int32', 'uint32']);
const NUMBER_CHECKS = new Set(['greater_than', 'less_than', 'multiple_of', 'number_format']);
/** The words api/schema-rules.ts refuses in request keys: the envelope names the tenant and actor. */
const IDENTITY_WORDS = ['tenant', 'actor', 'createdby', 'updatedby', 'userid'];
/** ASCII only, so a look-alike letter cannot slip a name past the words above. */
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Schemas whose values a permission, release or blind review restricts (ADR 0034). */
const restricted = new WeakSet<object>();

/**
 * Marks a schema whose values are restricted, such as a decision outcome or
 * a score, so no event payload can reuse it. Marked by definition, so copies
 * made by `.meta()`, `.describe()` and `.brand()` are caught too.
 */
export function markRestricted<S extends Schema>(schema: S): S {
  restricted.add(schema._zod.def);
  return schema;
}

function samePattern(def: Def, canonical: Schema): boolean {
  return String(def['pattern']) === String((canonical._zod.def as Def)['pattern']);
}

function stringProblem(def: Def): string | undefined {
  if (def['format'] === 'uuid') {
    const version = def['version'] as z.core.$ZodUUIDDef['version'];
    return samePattern(def, z.uuid({ version })) ? undefined : 'is a uuid with its own pattern';
  }
  if (def['format'] === 'datetime') {
    if (def['local'] === true) return 'is a timestamp without an offset';
    const canonical = z.iso.datetime({
      offset: def['offset'] === true,
      precision: def['precision'] as number | null | undefined,
    });
    return samePattern(def, canonical) ? undefined : 'is a timestamp with its own pattern';
  }
  return 'is a string';
}

function numberProblem(def: Def): string | undefined {
  const checks = (def.checks ?? []).map((check) => check._zod.def);
  const integer = (format: unknown) => typeof format === 'string' && INTEGER_FORMATS.has(format);
  if (!checks.every((check) => NUMBER_CHECKS.has(check.check))) {
    return 'has a refinement or transform';
  }
  const isInteger =
    integer(def['format']) ||
    checks.some((check) => check.check === 'number_format' && integer(check.format));
  return isInteger ? undefined : 'is a number that is not an integer';
}

function keyProblem(key: string): string | undefined {
  if (!KEY.test(key)) return 'is not a plain ASCII name';
  const name = key.toLowerCase().replaceAll('_', '');
  return IDENTITY_WORDS.some((word) => name.includes(word))
    ? 'names the tenant or acting user, which the envelope carries'
    : undefined;
}

const isString = (value: unknown) => typeof value === 'string';

function nodeProblem(def: Def, event: boolean): string | undefined {
  if (event && restricted.has(def)) return 'reuses a restricted schema';
  if (def.type === 'number') return numberProblem(def);
  if ((def.checks?.length ?? 0) > 0) return 'has a refinement or transform';
  switch (def.type) {
    case 'object':
      return (def['catchall'] as Schema | undefined)?._zod.def.type === 'never'
        ? undefined
        : 'is an object that takes unknown keys';
    case 'optional':
    case 'nullable':
      return undefined;
    case 'enum':
      return Object.values(def['entries'] as object).every(isString)
        ? undefined
        : 'is an enum with values that are not strings';
    case 'literal':
      return (def['values'] as unknown[]).every(isString)
        ? undefined
        : 'is a literal that is not a string';
    case 'string':
      return stringProblem(def);
    default:
      return `is ${def.type}, not an id, enum, integer or timestamp`;
  }
}

function walk(schema: Schema, path: string, event: boolean, problems: LeafProblem[]): void {
  const def = schema._zod.def as Def;
  const problem = nodeProblem(def, event);
  if (problem !== undefined) {
    problems.push({ path, reason: problem });
  } else if (def.type === 'optional' || def.type === 'nullable') {
    walk(def['innerType'] as Schema, path, event, problems);
  } else if (def.type === 'object') {
    for (const [key, value] of Object.entries(def['shape'] as Record<string, Schema>)) {
      const at = path === '' ? key : `${path}.${key}`;
      const keyReason = event ? keyProblem(key) : undefined;
      if (keyReason !== undefined) problems.push({ path: at, reason: keyReason });
      walk(value, at, event, problems);
    }
  }
}

/**
 * Every leaf of a job or event payload schema that is not an id, enum,
 * integer or timestamp, and every object that is not strict.
 */
export function payloadLeafProblems(schema: Schema): LeafProblem[] {
  const problems: LeafProblem[] = [];
  walk(schema, '', false, problems);
  return problems;
}

/**
 * The leaf rules, plus an event's own: a strict object at the root, no key
 * naming the tenant or actor, and no restricted schema.
 */
export function eventDataProblems(schema: Schema): LeafProblem[] {
  if (schema._zod.def.type !== 'object') return [{ path: '', reason: 'is not a strict object' }];
  const problems: LeafProblem[] = [];
  walk(schema, '', true, problems);
  return problems;
}
