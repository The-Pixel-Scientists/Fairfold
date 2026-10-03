// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turns the failures of request validation into a list of fields and plain
// English messages (ADR 0004). The message comes from the kind of failure, not
// from the submitted value, so a problem never repeats what was sent: not a
// value, and not an unknown key unless it looks like a field id.

/** One thing to fix, and where it is. */
export interface FieldProblem {
  /** Where the problem is, such as `body.answers.f_0a1b`, `query.page` or `params.id`. */
  field: string;
  message: string;
}

export const MAX_FIELD_PROBLEMS = 20;
const MAX_CUSTOM_MESSAGE_LENGTH = 200;

/** The part of a Fastify validation error this file reads. */
export interface ValidationEntry {
  keyword?: unknown;
  instancePath?: unknown;
  message?: unknown;
  params?: unknown;
}

/** Fastify's name for each part of a request, and the name this API shows. */
const LOCATIONS = new Map<string, string>([
  ['body', 'body'],
  ['querystring', 'query'],
  ['params', 'params'],
  ['headers', 'headers'],
]);

/** A path segment is a field id or a list position. Anything else could be echoed input. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function safeSegment(segment: string): string {
  return SAFE_SEGMENT.test(segment) ? segment : '*';
}

function numberText(value: unknown): string | undefined {
  return typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}

function plural(amount: string, noun: string): string {
  return `${amount} ${noun}${amount === '1' ? '' : 's'}`;
}

function paramsOf(entry: ValidationEntry): Record<string, unknown> {
  return typeof entry.params === 'object' && entry.params !== null
    ? (entry.params as Record<string, unknown>)
    : {};
}

/** Plain English for one Zod issue, from its code. Never built from the submitted value. */
function messageFor(entry: ValidationEntry): string {
  const params = paramsOf(entry);
  switch (entry.keyword) {
    case 'invalid_type':
      switch (params['expected']) {
        case 'string':
          return 'Enter text.';
        case 'number':
          return 'Enter a number.';
        case 'int':
          return 'Enter a whole number.';
        case 'boolean':
          return 'Choose true or false.';
        case 'array':
          return 'Send a list.';
        case 'object':
          return 'Send an object.';
        default:
          return 'Enter a value of the expected type.';
      }
    case 'too_small': {
      const minimum = numberText(params['minimum']);
      if (minimum === undefined) return 'This value is too small.';
      if (params['origin'] === 'string') return `Enter at least ${plural(minimum, 'character')}.`;
      if (params['origin'] === 'array' || params['origin'] === 'set') {
        return `Add at least ${plural(minimum, 'item')}.`;
      }
      return params['inclusive'] === false
        ? `Enter more than ${minimum}.`
        : `Enter ${minimum} or more.`;
    }
    case 'too_big': {
      const maximum = numberText(params['maximum']);
      if (maximum === undefined) return 'This value is too large.';
      if (params['origin'] === 'string')
        return `Enter no more than ${plural(maximum, 'character')}.`;
      if (params['origin'] === 'array' || params['origin'] === 'set') {
        return `Add no more than ${plural(maximum, 'item')}.`;
      }
      return params['inclusive'] === false
        ? `Enter less than ${maximum}.`
        : `Enter ${maximum} or less.`;
    }
    case 'invalid_format':
      switch (params['format']) {
        case 'email':
          return 'Enter a valid email address.';
        case 'url':
          return 'Enter a valid web address.';
        case 'uuid':
        case 'guid':
          return 'This id is not valid.';
        case 'date':
        case 'datetime':
          return 'Enter a valid date.';
        default:
          return 'This value is not in the expected format.';
      }
    case 'invalid_value':
      return 'Choose one of the allowed values.';
    case 'not_multiple_of':
      return 'This number is not a valid multiple.';
    case 'invalid_union':
      return 'This value does not match any allowed format.';
    case 'custom':
      // Written by us in a domain schema, to be shown.
      return typeof entry.message === 'string' && entry.message !== ''
        ? entry.message.slice(0, MAX_CUSTOM_MESSAGE_LENGTH)
        : 'This value is not valid.';
    default:
      return 'This value is not valid.';
  }
}

/**
 * The fields a validation failure names, from Fastify's validation error. The
 * field is the part of the request and the path inside it. Unknown keys are
 * named too, if they look like field ids.
 */
export function fieldProblems(
  validation: readonly ValidationEntry[],
  context: string | undefined,
): FieldProblem[] {
  const location = (context === undefined ? undefined : LOCATIONS.get(context)) ?? 'request';
  const problems: FieldProblem[] = [];
  for (const entry of validation) {
    if (problems.length >= MAX_FIELD_PROBLEMS) break;
    const path =
      typeof entry.instancePath === 'string'
        ? entry.instancePath.split('/').filter((segment) => segment !== '')
        : [];
    const segments = path.map(safeSegment);
    if (entry.keyword === 'unrecognized_keys') {
      const keys = paramsOf(entry)['keys'];
      for (const key of Array.isArray(keys) ? (keys as unknown[]) : []) {
        if (problems.length >= MAX_FIELD_PROBLEMS) break;
        problems.push({
          field: [location, ...segments, safeSegment(typeof key === 'string' ? key : '')].join('.'),
          message: 'This field is not accepted.',
        });
      }
      continue;
    }
    problems.push({ field: [location, ...segments].join('.'), message: messageFor(entry) });
  }
  return problems;
}
