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
//     and no email address goes in a URL; path parameters are ids, a form
//     question's :fieldId (ADR 0047), or that slug;
//   - responses hold no union of objects, lists and plain values;
//   - a raw (non-JSON) response answers 200 in content types from a fixed
//     list, and a raw upload body is a file's bytes up to a limit.

import type { z } from 'zod';

import { MAX_FILE_BYTES, type FileType } from '../files/types.ts';
import { fieldIdSchema } from '../forms/definition.ts';
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
const FIELD_ID_PATTERN = toJsonSchema(fieldIdSchema, 'input')?.['pattern'];

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

/**
 * Path parameters: exactly those the path names, each required, each an id,
 * the tenant slug, or a form question's stable id as `:fieldId`.
 */
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
        : name === 'fieldId'
          ? param['pattern'] === FIELD_ID_PATTERN
          : param['format'] === 'uuid' && param['pattern'] === ID_PATTERN);
    if (!valid) {
      problems.push(
        `The path parameter :${name} must be required, and an id, a field id or the tenant slug.`,
      );
    }
  }
  return problems;
}

/** The content types a public route's raw response may have (S03-11): a stylesheet or an image. */
export const rawContentTypes = ['text/css', 'image/png', 'image/webp'] as const;

export type RawContentType = (typeof rawContentTypes)[number];

/**
 * A response that is not JSON, in one of the content types named: a
 * stylesheet or an image on a public route, a stored file on a console or
 * portal route (ADR 0047).
 */
export interface RawBody {
  readonly raw: readonly (RawContentType | FileType)[];
}

/** The content type of a raw upload body. */
export const rawUploadContentType = 'application/octet-stream';

/**
 * A request body that is a file's bytes, not JSON, of at most `maxBytes`
 * (ADR 0047). The file's name travels percent-encoded in the `File-Name`
 * header, never in the URL. The bytes and any declared type are claims: the
 * server finds the type with sniffFileType().
 */
export interface RawUploadBody {
  readonly raw: readonly [typeof rawUploadContentType];
  readonly maxBytes: number;
}

export type RequestBody = z.ZodType | RawUploadBody;

export type ResponseBody = z.ZodType | null | RawBody;

/** A raw response or a raw upload body, as opposed to a schema or no body. */
export function isRawBody(body: unknown): body is RawBody | RawUploadBody {
  return typeof body === 'object' && body !== null && Object.hasOwn(body, 'raw');
}

function isListOnce(types: unknown, allowed: readonly string[]): boolean {
  return (
    Array.isArray(types) &&
    types.length > 0 &&
    new Set(types).size === types.length &&
    types.every((type) => allowed.includes(type as string))
  );
}

/** Read as unknown: a cast or plain JavaScript can get past the types. */
export function rawBodyProblems(
  status: string,
  body: RawBody,
  allowed: readonly string[],
): string[] {
  const problems: string[] = [];
  if (status !== '200') problems.push(`A raw body answers 200 only, not ${status}.`);
  if (Object.keys(body).length !== 1 || !isListOnce(body.raw, allowed)) {
    problems.push(`A raw body names one or more content types once each: ${allowed.join(', ')}.`);
  }
  return problems;
}

/** Read as unknown, as above. */
export function rawUploadProblems(body: RawUploadBody): string[] {
  const { raw, maxBytes } = body as { raw: unknown; maxBytes: unknown };
  const valid =
    Object.keys(body).sort().join() === 'maxBytes,raw' &&
    isListOnce(raw, [rawUploadContentType]) &&
    Number.isSafeInteger(maxBytes) &&
    (maxBytes as number) >= 1 &&
    (maxBytes as number) <= MAX_FILE_BYTES;
  return valid
    ? []
    : [
        `A raw upload body is { raw: ['${rawUploadContentType}'], maxBytes } with maxBytes from 1 to ${MAX_FILE_BYTES}.`,
      ];
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
