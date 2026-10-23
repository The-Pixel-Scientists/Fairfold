// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The scope rules of the applicant's routes (ADR 0004). A false answer is a
// 404, exactly as a record that does not exist reads, so a caller learns
// nothing about another applicant's records or a round not taking
// applications. A route that lists applies its own filter in its handler and
// has nothing to refuse here.

import { personIdForUser } from '@pixel-scientists/party/server';

import { getApplication, getOpenRound } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { isOpenRound } from './rounds.ts';
import { applicationsDb } from './tables.ts';

export interface ScopeCheck {
  readonly tx: Tx;
  readonly userId: string;
  readonly input: { readonly params: unknown };
}

/** The application in the path, whatever else the path names (a field or a file). */
const applicationParams = getApplication.params.loose();

export const grantsResolvers = {
  /** A round taking applications, by the database's clock. */
  open_round: async ({ tx, input }: ScopeCheck): Promise<boolean> => {
    if (input.params === undefined) return true;
    const params = getOpenRound.params.safeParse(input.params);
    return params.success && isOpenRound(tx, params.data.roundId);
  },

  /** An application whose applicant is the session's person. */
  own_application: async ({ tx, userId, input }: ScopeCheck): Promise<boolean> => {
    if (input.params === undefined) return true;
    const params = applicationParams.safeParse(input.params);
    if (!params.success) return false;
    const personId = await personIdForUser(tx, userId);
    if (personId === null) return false;
    const row = await applicationsDb(tx)
      .selectFrom('grants.application')
      .select('id')
      .where('id', '=', params.data.applicationId)
      .where('applicant_person_id', '=', personId)
      .executeTakeFirst();
    return row !== undefined;
  },
};
