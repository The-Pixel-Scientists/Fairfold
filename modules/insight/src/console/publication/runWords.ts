// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PublicationRun } from '../../contracts/index.ts';
import { formatDate, publicationStateLabels } from '../format.ts';

export const period = (run: Pick<PublicationRun, 'periodStart' | 'periodEnd'>) =>
  `${formatDate(run.periodStart)} to ${formatDate(run.periodEnd)}`;

/** A run's state in words: "Submitted by You on 1 April 2027" once someone has recorded it. */
export function stateWords(run: PublicationRun, who: (membershipId: string) => string): string {
  if (
    run.state === 'submitted' &&
    run.submittedAt !== null &&
    run.submittedByMembershipId !== null
  ) {
    return `Submitted by ${who(run.submittedByMembershipId)} on ${formatDate(run.submittedAt)}`;
  }
  return publicationStateLabels[run.state];
}
