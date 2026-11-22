// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the assure pages, inside the funder's address.

export const ASSURE_PATH = '/assure';

export const organisationLookupsPath = (organisationId: string) =>
  `/assure/organisations/${organisationId}`;
export const matchPath = (matchId: string) => `/assure/matches/${matchId}`;

export const CHECKLISTS_PATH = '/assure/checklists';
export const NEW_CHECKLIST_PATH = '/assure/checklists/new';
export const checklistPath = (checklistId: string) => `/assure/checklists/${checklistId}`;
export const VISITS_PATH = '/assure/visits';
export const NEW_VISIT_PATH = '/assure/visits/new';
export const visitPath = (visitId: string) => `/assure/visits/${visitId}`;
export const applicationPath = (applicationId: string) => `/assure/applications/${applicationId}`;
