// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each page reads from the API when it opens. Defined once, here, so
// useLoad reads again only when the page asks it to.

import { call } from '@pixel-scientists/domain/api';

import {
  getEmailTemplates,
  getProgramme,
  getProgrammeHistory,
  getRound,
  getRoundHistory,
  listProgrammes,
  listRounds,
  listStages,
} from '../../contracts/index.ts';

export const loadProgrammes = () => call(listProgrammes, {});

export const loadProgramme = (programmeId: string) =>
  call(getProgramme, { params: { programmeId } });

export const loadRounds = (programmeId: string) => call(listRounds, { params: { programmeId } });

export const loadEmails = (programmeId: string) =>
  call(getEmailTemplates, { params: { programmeId } });

export const loadProgrammeHistory = (programmeId: string) =>
  call(getProgrammeHistory, { params: { programmeId } });

export const loadRoundHistory = (roundId: string) => call(getRoundHistory, { params: { roundId } });

/** A round with the programme it belongs to and its stages. */
export async function loadRound(roundId: string) {
  const round = await call(getRound, { params: { roundId } });
  const [programme, { stages }] = await Promise.all([
    call(getProgramme, { params: { programmeId: round.programmeId } }),
    call(listStages, { params: { roundId } }),
  ]);
  return { round, programme, stages };
}

/** A programme with its outcome email templates. */
export async function loadEmailPage(programmeId: string) {
  const [programme, templates] = await Promise.all([
    call(getProgramme, { params: { programmeId } }),
    call(getEmailTemplates, { params: { programmeId } }),
  ]);
  return { programme, templates };
}
