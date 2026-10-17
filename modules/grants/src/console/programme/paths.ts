// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the programme set-up pages, inside the funder's address.

export const PROGRAMMES_PATH = '/';
export const NEW_PROGRAMME_PATH = '/programmes/new';

export const programmePath = (programmeId: string) => `/programmes/${programmeId}`;
export const editProgrammePath = (programmeId: string) => `/programmes/${programmeId}/edit`;
export const emailsPath = (programmeId: string) => `/programmes/${programmeId}/emails`;
export const newRoundPath = (programmeId: string) => `/programmes/${programmeId}/rounds/new`;

export const roundPath = (roundId: string) => `/rounds/${roundId}`;
export const editRoundPath = (roundId: string) => `/rounds/${roundId}/edit`;
export const stagesPath = (roundId: string) => `/rounds/${roundId}/stages`;
export const rubricPath = (roundId: string, stageId: string) =>
  `/rounds/${roundId}/stages/${stageId}/rubric`;
