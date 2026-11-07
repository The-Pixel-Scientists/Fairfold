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

/** One form version with its round and programme, and the definitions of the round's published versions. */
export async function loadVersion(formVersionId: string) {
  const version = await call(getFormVersion, { params: { formVersionId } });
  const [context, { versions }] = await Promise.all([
    loadRoundAndProgramme(version.roundId),
    call(listFormVersions, { params: { roundId: version.roundId } }),
  ]);
  const published = await Promise.all(
    versions
      .filter((item) => item.status === 'published')
      .map((item) => call(getFormVersion, { params: { formVersionId: item.id } })),
  );
  const earlier = published.flatMap((item) => (item.definition === null ? [] : [item.definition]));
  return { version, earlier, ...context };
}
