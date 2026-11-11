// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The application a note or message is about. Staff never see a draft, and an
// applicant reaches only their own application, so a draft, someone else's
// application and an id that exists nowhere all answer the same: no record.

import type { Tx } from '../programme/tables.ts';
import { noteDb } from './tables.ts';

export interface SubmittedApplication {
  readonly id: string;
  readonly applicantPersonId: string;
}

/**
 * The submitted or withdrawn application, in the caller's tenant, or undefined. With `lock`
 * the row is held until the transaction ends, so two first messages are made one after the other.
 */
export async function submittedApplication(
  tx: Tx,
  applicationId: string,
  options: { applicantPersonId?: string; lock?: boolean } = {},
): Promise<SubmittedApplication | undefined> {
  let query = noteDb(tx)
    .selectFrom('grants.application')
    .select(['id', 'applicant_person_id'])
    .where('id', '=', applicationId)
    .where('status', '<>', 'draft');
  if (options.applicantPersonId !== undefined) {
    query = query.where('applicant_person_id', '=', options.applicantPersonId);
  }
  const row = await (options.lock === true ? query.forNoKeyUpdate() : query).executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, applicantPersonId: row.applicant_person_id };
}
