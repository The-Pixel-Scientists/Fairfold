// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turns the failures of request validation into a list of fields and plain
// English messages (ADR 0004). The words and the field names come from the
// domain package's catalogue, the same as in the browser, so a person sees
// the same message at the same field whichever side caught the problem. A
// problem never repeats what was sent: not a value, and not an unknown key
// unless it looks like a field id.

import {
  fieldForIssue,
  messageForIssue,
  type FieldProblem,
  type IssueLike,
} from '@pixel-scientists/domain/platform';

export type { FieldProblem };

export const MAX_FIELD_PROBLEMS = 20;

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

function paramsOf(entry: ValidationEntry): Record<string, unknown> {
  return typeof entry.params === 'object' && entry.params !== null
    ? (entry.params as Record<string, unknown>)
    : {};
}

/** The entry as the Zod issue it came from, which is what the catalogue reads. */
function issueOf(entry: ValidationEntry, path: readonly string[]): IssueLike {
  return { ...paramsOf(entry), code: entry.keyword, message: entry.message, path };
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
    if (entry.keyword === 'unrecognized_keys') {
      const keys = paramsOf(entry)['keys'];
      for (const key of Array.isArray(keys) ? (keys as unknown[]) : []) {
        if (problems.length >= MAX_FIELD_PROBLEMS) break;
        const issue = issueOf(entry, [...path, typeof key === 'string' ? key : '']);
        problems.push({ field: fieldForIssue(location, issue), message: messageForIssue(issue) });
      }
      continue;
    }
    const issue = issueOf(entry, path);
    problems.push({ field: fieldForIssue(location, issue), message: messageForIssue(issue) });
  }
  return problems;
}
