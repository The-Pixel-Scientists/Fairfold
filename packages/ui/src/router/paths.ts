// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Paths, matching and the internal-path rule for the router (ADR 0014).

export type Params = Readonly<Record<string, string>>;

/** A host that cannot exist, so only the path of a destination is kept. */
const APP_ORIGIN = 'http://app.invalid';

/** Thrown when something that is not a path inside the app is used as a destination. */
export class InvalidAppPathError extends Error {
  override name = 'InvalidAppPathError';
}

/** Control characters, spaces and backslashes: browsers read these as part of a host or drop them. */
function hasForbiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

const REFUSED = 'Navigation accepts only paths inside the app, such as "/applications".';

/** A `.` or `..` segment, even percent-encoded. The URL parser resolves these, turning `/..//host` into `//host`. */
function hasDotSegment(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  return pathname.split('/').some((segment) => {
    const plain = segment.replace(/%2e/gi, '.');
    return plain === '.' || plain === '..';
  });
}

/**
 * An app path starts with one `/`, has no backslash, space, control character
 * or dot segment, and so can only name a page in this app. `//evil.example`,
 * `/\evil.example`, `/..//evil.example`, `https://evil.example` and
 * `javascript:alert(1)` are all refused.
 */
export function isAppPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !hasForbiddenCharacter(value) &&
    !hasDotSegment(value)
  );
}

/** Return the path, or throw InvalidAppPathError. The message never repeats the value. */
export function assertAppPath(value: string): string {
  if (!isAppPath(value)) throw new InvalidAppPathError(REFUSED);
  return value;
}

/**
 * Turn a destination into the address to push and to put in a link's href:
 * the base path, then the parsed path, search and hash. Refuses anything that
 * does not stay on the same origin or that parses to a path starting `//`.
 */
export function resolveAppPath(
  basePath: string,
  to: string,
): { location: { pathname: string; search: string; hash: string }; href: string } {
  assertAppPath(to);
  const url = new URL(to, APP_ORIGIN);
  if (url.origin !== APP_ORIGIN || url.pathname.startsWith('//')) {
    throw new InvalidAppPathError(REFUSED);
  }
  const { pathname, search, hash } = url;
  return {
    location: { pathname, search, hash },
    href: assertAppPath(`${basePath}${pathname}${search}${hash}`),
  };
}

/** One or more segments of plain characters: no empty segment, no percent-encoding, no query or hash. */
const BASE_PATH = /^(?:\/[A-Za-z0-9._~-]+)+$/;

/**
 * Read an optional base path: empty for an app served from the root, or
 * something like `/northfield` (a tenant's slug) or `/console` when one host
 * serves both apps. No trailing slash. Anything but plain segments, and any
 * dot segment, throws InvalidAppPathError.
 */
export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, '');
  if (trimmed === '') return '';
  if (!BASE_PATH.test(trimmed)) throw new InvalidAppPathError(REFUSED);
  return assertAppPath(trimmed);
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/**
 * Match a pathname against a pattern such as `/applications/:id`. Segments
 * that start with `:` capture a decoded value. A trailing slash makes no
 * difference. Returns null when the path does not match.
 */
export function matchPath(pattern: string, pathname: string): Params | null {
  const patternSegments = segmentsOf(pattern);
  const pathSegments = segmentsOf(pathname);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (const [index, patternSegment] of patternSegments.entries()) {
    const pathSegment = pathSegments[index];
    if (pathSegment === undefined) return null;
    if (patternSegment.startsWith(':')) {
      try {
        params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      } catch {
        return null;
      }
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

/** Keys that could reach an object's prototype: dropped from the search record. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Turn a search string into a record for a schema: one value stays a string,
 * a key that repeats becomes an array of strings. The record has no
 * prototype, so a key such as `toString` cannot shadow a method, and
 * `__proto__`, `constructor` and `prototype` are dropped as well.
 */
export function searchToRecord(search: string): Record<string, string | string[]> {
  const record = Object.create(null) as Record<string, string | string[]>;
  for (const [key, value] of new URLSearchParams(search)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const existing = record[key];
    if (existing === undefined) record[key] = value;
    else record[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return record;
}
