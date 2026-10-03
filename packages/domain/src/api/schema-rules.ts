// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rules a route's schemas keep (ADR 0004, ADR 0019), checked on their
// JSON Schema form, which is what the OpenAPI document shows too:
//   - every schema converts: a request on both its input and its output
//     side, a response on its output side, so nothing custom or recursive,
//     and no transform without a schema for its result;
//   - no value of any type, and no object or record taking keys it does not
//     name or check;
//   - request keys are plain ASCII names that never name the acting user or
//     tenant, a slug is only the :slug of /public/tenants/ or /auth/tenants/,
//     and no email address goes in a URL; path parameters are ids, or that
//     slug;
//   - responses hold no union of objects, lists and plain values.

import type { z } from 'zod';

import { idSchema } from '../id.ts';
import { slugPattern } from '../platform/tenant.ts';
import {
  isAnyShape,
  isObject,
  isOpenObject,
  isUntyped,
  keysOf,
  list,
  schemaNodes,
  toJsonSchema,
  type JsonSchema,
} from './json-schema.ts';

/** The only paths that may name a tenant by its slug. */
const SLUG_PATH = /^\/(?:public|auth)\/tenants\/:slug(?:\/|$)/;
/** The acting user and tenant come from the session: no input names them, in any spelling. */
const IDENTITY_WORDS = ['tenant', 'actor', 'createdby', 'updatedby', 'userid'];
/** Keys a record's key pattern must refuse for its keys to count as checked. */
const IDENTITY_PROBES = [
  'tenantId',
  'tenant_id',
  'tenant',
  'userId',
  'user_id',
  'actorId',
  'actor',
  'createdBy',
  'created_by',
  'updatedBy',
  'updated_by',
];
/** ASCII only, so a look-alike letter cannot slip a name past the checks above. */
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const ID_PATTERN = toJsonSchema(idSchema, 'input')?.['pattern'];

function shapeProblems(label: string, root: JsonSchema): string[] {
  const problems: string[] = [];
  for (const node of schemaNodes(root)) {
    if (isUntyped(node)) problems.push(`${label} has a value of any type.`);
    else if (isOpenObject(node, IDENTITY_PROBES)) {
      problems.push(`${label} has an object that takes keys it does not name or check.`);
    }
  }
  return problems;
}

const NOT_CONVERTIBLE =
  'cannot be expressed as JSON Schema (custom, recursive, or a transform with no schema for its result).';

export function requestProblems(
  path: string,
  part: 'params' | 'query' | 'body',
  schema: z.ZodType,
): string[] {
  const input = toJsonSchema(schema, 'input');
  const output = toJsonSchema(schema, 'output');
  if (input === undefined || output === undefined) return [`${part} ${NOT_CONVERTIBLE}`];
  const problems: string[] = [];
  if (part !== 'body' && input['type'] !== 'object') problems.push(`${part} must be an object.`);
  for (const root of [input, output]) {
    problems.push(...shapeProblems(part, root));
    for (const node of schemaNodes(root)) {
      if (part !== 'body' && node['format'] === 'email') {
        problems.push(`${part} holds an email address; a URL carries ids only.`);
      }
      for (const key of keysOf(node)) problems.push(...keyProblems(path, part, key));
    }
  }
  return [...new Set(problems)];
}

function keyProblems(path: string, part: string, key: string): string[] {
  if (!KEY.test(key)) return [`${part} has a key that is not a plain ASCII name.`];
  const name = key.toLowerCase().replace(/_/g, '');
  if (IDENTITY_WORDS.some((word) => name.includes(word))) {
    return [`${part} names "${key}"; the acting user and tenant come from the session.`];
  }
  const slugAllowed = part === 'params' && key === 'slug' && SLUG_PATH.test(path);
  if (name.includes('slug') && !slugAllowed) {
    return [
      `${part} names "${key}"; a slug is only the :slug of /public/tenants/ or /auth/tenants/.`,
    ];
  }
  return [];
}

/** Path parameters: exactly those the path names, each required, each an id or the tenant slug. */
export function paramProblems(names: readonly string[], schema: z.ZodType | undefined): string[] {
  const root = schema === undefined ? {} : toJsonSchema(schema, 'input');
  if (root === undefined) return [];
  const properties = isObject(root['properties']) ? root['properties'] : {};
  const required = list(root['required']);
  const problems: string[] = [];
  if ([...names].sort().join() !== Object.keys(properties).sort().join()) {
    problems.push('params must name exactly the path parameters.');
  }
  for (const name of names) {
    const param = properties[name];
    const valid =
      isObject(param) &&
      required.includes(name) &&
      (name === 'slug'
        ? param['pattern'] === slugPattern.source
        : param['format'] === 'uuid' && param['pattern'] === ID_PATTERN);
    if (!valid) {
      problems.push(`The path parameter :${name} must be required, and an id or the tenant slug.`);
    }
  }
  return problems;
}

export function responseProblems(status: string, schema: z.ZodType | null): string[] {
  if (!/^2\d\d$/.test(status)) {
    return [`Response ${status} is not a success; errors are always problem details.`];
  }
  if (schema === null) {
    return status === '202' || status === '204' ? [] : [`Response ${status} needs a body schema.`];
  }
  const root = toJsonSchema(schema, 'output');
  if (root === undefined) return [`Response ${status} ${NOT_CONVERTIBLE}`];
  const problems = shapeProblems(`Response ${status}`, root);
  for (const node of schemaNodes(root)) {
    if (isAnyShape(node)) {
      problems.push(`Response ${status} has a union of objects, lists and plain values.`);
    }
  }
  return [...new Set(problems)];
}
