// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each page reads from the API. A record the member may not see reads
// the same as one that is not there, so the page cannot say which it is.

import { call, ProblemError } from '@pixel-scientists/domain/api';

import {
  decideScreeningMatch,
  getScreeningMatch,
  listLookupOfficers,
  listOrganisationLookups,
  listScreeningMatches,
  refreshOrganisationLookup,
} from '../contracts/index.ts';
import type { MatchQuery, Registry } from '../contracts/index.ts';

export const NOT_FOUND = { state: 'not_found' } as const;

export const loadLookups = (organisationId: string) =>
  call(listOrganisationLookups, { params: { organisationId } });

export const loadOfficers = (snapshotId: string) =>
  call(listLookupOfficers, { params: { snapshotId } });

/** Retrying with the key a failure gave sends the same request once, not twice. */
export const refreshLookup = (
  organisationId: string,
  registry: Registry,
  idempotencyKey?: string,
) =>
  call(
    refreshOrganisationLookup,
    { params: { organisationId }, body: { registry } },
    idempotencyKey === undefined ? {} : { idempotencyKey },
  );

export const loadMatches = (query: MatchQuery) => call(listScreeningMatches, { query });

export async function loadMatch(matchId: string) {
  try {
    return await call(getScreeningMatch, { params: { matchId } });
  } catch (error) {
    if (error instanceof ProblemError && (error.status === 403 || error.status === 404)) {
      return NOT_FOUND;
    }
    throw error;
  }
}

/** The body holds an outcome and a reason, and nothing else: the member comes from the session. */
export const decideMatch = (matchId: string, body: { outcome: string; reason: string }) =>
  call(decideScreeningMatch, { params: { matchId }, body });
