// SPDX-License-Identifier: AGPL-3.0-or-later

/** Join class names, skipping anything that is not a string. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
