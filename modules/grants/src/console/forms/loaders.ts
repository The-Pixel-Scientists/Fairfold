// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form pages read from the API when they open. Defined once, here,
// so useLoad reads again only when the page asks it to.

import { call } from '@pixel-scientists/domain/api';

import { getFormVersion, getProgramme, getRound, listFormVersions } from '../../contracts/index.ts';

/** A round and the programme it belongs to, for the page's breadcrumbs and dates. */
async function loadRoundAndProgramme(roundId: string) {
  const round = await call(getRound, { params: { roundId } });
  const programme = await call(getProgramme, { params: { programmeId: round.programmeId } });
  return { round, programme };
}

/** A round with its form versions, the newest first. */
export async function loadVersions(roundId: string) {
  const [context, { versions }] = await Promise.all([
    loadRoundAndProgramme(roundId),
    call(listFormVersions, { params: { roundId } }),
  ]);
  return { ...context, versions };
}

/** One form version with its round and programme. */
export async function loadVersion(formVersionId: string) {
  const version = await call(getFormVersion, { params: { formVersionId } });
  return { version, ...(await loadRoundAndProgramme(version.roundId)) };
}
