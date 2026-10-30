// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The log's filters as the address holds them. The address is the source of
// truth. The contract's query schema reads it, less the page cursor, which is
// never in an address, so a hand-edited address is refused as the API would.

import { auditEventQuerySchema } from '@pixel-scientists/domain/platform/audit-log';
import type { AuditEventQuery } from '@pixel-scientists/domain/platform/audit-log';

export type AuditFilters = Omit<AuditEventQuery, 'cursor'>;

export const filtersSchema = auditEventQuerySchema.omit({ cursor: true });

/** In the order they appear in the address. */
export const FILTER_KEYS = [
  'module',
  'action',
  'entityType',
  'entityId',
  'byMembershipId',
  'from',
  'to',
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** "?module=grants", or an empty string when there is nothing to say. */
export function searchOf(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export const isFiltered = (filters: AuditFilters): boolean =>
  FILTER_KEYS.some((key) => filters[key] !== undefined);

/** What a person types or chooses: every filter as text, with "" for none. */
export type Draft = Record<FilterKey, string>;

export const draftOf = (filters: AuditFilters): Draft => ({
  module: filters.module ?? '',
  action: filters.action ?? '',
  entityType: filters.entityType ?? '',
  entityId: filters.entityId ?? '',
  byMembershipId: filters.byMembershipId ?? '',
  from: filters.from ?? '',
  to: filters.to ?? '',
});

const MESSAGES: Partial<Record<FilterKey, string>> = {
  entityId: 'Enter the whole ID, such as 0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10.',
  from: 'Enter a date, such as 14 October 2026.',
  to: 'Enter a date, such as 14 October 2026.',
};

export type FilterResult =
  { ok: true; filters: AuditFilters } | { ok: false; errors: Partial<Record<FilterKey, string>> };

/** Checks a draft the way the API will, with each problem said next to its field. */
export function filtersFrom(draft: Draft): FilterResult {
  const given = Object.fromEntries(
    FILTER_KEYS.flatMap((key) => (draft[key] === '' ? [] : [[key, draft[key]]])),
  );
  const parsed = filtersSchema.safeParse(given);
  const errors: Partial<Record<FilterKey, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = FILTER_KEYS.find((name) => name === issue.path[0]);
      if (key !== undefined) errors[key] = MESSAGES[key] ?? 'Choose one of the options.';
    }
  } else if (
    parsed.data.from !== undefined &&
    parsed.data.to !== undefined &&
    parsed.data.to < parsed.data.from
  ) {
    errors.to = 'Enter an end date on or after the start date.';
  }
  return parsed.success && Object.keys(errors).length === 0
    ? { ok: true, filters: parsed.data }
    : { ok: false, errors };
}
