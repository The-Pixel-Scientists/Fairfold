// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each page reads from the API. A record the member may not see reads
// the same as one that is not there, so the page cannot say which it is.

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { getOrganisationHistory, getPersonHistory } from '@pixel-scientists/party/contracts';

import {
  getOrganisationRecord,
  getPersonRecord,
  getTimeline,
  searchParties,
} from '../contracts/index.ts';
import type { PartySearchRequest } from '../contracts/index.ts';

export const NOT_FOUND = { state: 'not_found' } as const;

async function orNotFound<T>(read: () => Promise<T>): Promise<T | typeof NOT_FOUND> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ProblemError && (error.status === 403 || error.status === 404)) {
      return NOT_FOUND;
    }
    throw error;
  }
}

export const loadOrganisation = (organisationId: string) =>
  orNotFound(() => call(getOrganisationRecord, { params: { organisationId } }));

export const loadPerson = (personId: string) =>
  orNotFound(() => call(getPersonRecord, { params: { personId } }));

/** The term travels in the body, never in an address. */
export const search = (body: PartySearchRequest) => call(searchParties, { body });

export const loadTimeline = (partyId: string, cursor?: string) =>
  call(getTimeline, { params: { partyId }, query: cursor === undefined ? {} : { cursor } });

export const loadOrganisationHistory = (organisationId: string, cursor?: string) =>
  call(getOrganisationHistory, {
    params: { organisationId },
    query: cursor === undefined ? {} : { cursor },
  });

export const loadPersonHistory = (personId: string, cursor?: string) =>
  call(getPersonHistory, { params: { personId }, query: cursor === undefined ? {} : { cursor } });
