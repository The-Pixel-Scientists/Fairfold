// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 14 applications the panel accepted, each in its area and theme. They come
// from the story's applications, so the areas, the themes, the warehouse and
// the audit log all add up to the same £187,500.

import { applications } from '../story.ts';

export interface Grant {
  reference: string;
  organisation: string;
  /** The amount awarded: what was asked for, or less where the panel cut it. */
  amount: number;
  area: string;
  theme: string;
}

export const grants: readonly Grant[] = applications.flatMap(
  ({ reference, organisation, amount, area, theme, decision }) =>
    decision === 'Accept' && amount !== undefined
      ? [{ reference, organisation, amount, area, theme }]
      : [],
);

/** The grants in one area or one theme, by its name. */
export const grantsIn = (field: 'area' | 'theme', name: string): readonly Grant[] =>
  grants.filter((grant) => grant[field] === name);

export const amountOf = (list: readonly Grant[]): number =>
  list.reduce((sum, grant) => sum + grant.amount, 0);
