// SPDX-License-Identifier: AGPL-3.0-or-later

/** The stage of a round that submissions are assigned at: assignments belong to one stage. */
export interface AssignTarget {
  roundId: string;
  stageId: string;
  stageName: string;
}

interface Placed {
  round: { id: string };
  stage: { id: string; name: string };
}

/** The stage every one of these submissions is in, or null when there are none or they are in more than one. */
export function targetOf(items: readonly Placed[]): AssignTarget | null {
  const [first] = items;
  if (first === undefined) return null;
  const same = items.every(
    ({ round, stage }) => round.id === first.round.id && stage.id === first.stage.id,
  );
  return same
    ? { roundId: first.round.id, stageId: first.stage.id, stageName: first.stage.name }
    : null;
}
