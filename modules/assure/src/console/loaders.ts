// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each page reads from the API. A record the member may not see reads
// the same as one that is not there, so the page cannot say which it is.

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { searchTerm } from '@pixel-scientists/domain/platform/search';

import {
  createChecklist,
  createVisit,
  decideScreeningMatch,
  getChecklist,
  getChecklistResponse,
  getScreeningMatch,
  getVisit,
  listApplicationChecklists,
  listApplicationDuplicateFlags,
  listChecklists,
  listVisits,
  publishChecklistVersion,
  saveChecklistResponse,
  updateVisit,
  listLookupOfficers,
  listOrganisationLookups,
  listScreeningMatches,
  refreshOrganisationLookup,
} from '../contracts/index.ts';
import type {
  ChecklistInput,
  ChecklistResponseInput,
  MatchQuery,
  Registry,
  VisitInput,
  VisitUpdate,
} from '../contracts/index.ts';

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

export const loadFlags = (applicationId: string) =>
  call(listApplicationDuplicateFlags, { params: { applicationId } });

export const loadChecklists = () => call(listChecklists, {});

export const loadChecklist = (checklistId: string) =>
  call(getChecklist, { params: { checklistId } });

/** Create and publish send the checklist and nothing about who made it; a retry reuses the key. */
export const saveChecklist = (
  checklistId: string | null,
  body: ChecklistInput,
  idempotencyKey?: string,
) => {
  const options = idempotencyKey === undefined ? {} : { idempotencyKey };
  return checklistId === null
    ? call(createChecklist, { body }, options)
    : call(publishChecklistVersion, { params: { checklistId }, body }, options);
};

export const loadApplicationChecklists = (applicationId: string) =>
  call(listApplicationChecklists, { params: { applicationId } });

export const loadResponse = (key: { applicationId: string; checklistId: string }) =>
  call(getChecklistResponse, { params: key });

export const saveResponse = (
  params: { applicationId: string; checklistId: string },
  body: ChecklistResponseInput,
) => call(saveChecklistResponse, { params, body });

export const loadVisits = (query: { cursor?: string }) => call(listVisits, { query });

export async function loadVisit(visitId: string) {
  try {
    return await call(getVisit, { params: { visitId } });
  } catch (error) {
    if (error instanceof ProblemError && (error.status === 403 || error.status === 404)) {
      return NOT_FOUND;
    }
    throw error;
  }
}

export const recordVisit = (body: VisitInput, idempotencyKey?: string) =>
  call(createVisit, { body }, idempotencyKey === undefined ? {} : { idempotencyKey });

export const changeVisit = (visitId: string, body: VisitUpdate) =>
  call(updateVisit, { params: { visitId }, body });

/** Organisations, people and applications by name, from the platform search. The term stays in the body. */
export async function findRecords(term: string, module: 'crm' | 'grants', kind: string) {
  const found = await call(searchTerm, { body: { term, modules: [module] } });
  if (found.audience !== 'staff') return [];
  return found.groups.flatMap((group) => group.results).filter((result) => result.kind === kind);
}
