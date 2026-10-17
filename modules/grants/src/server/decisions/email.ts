// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a decision's email is filled with (ADR 0004, ADR 0020): the
// applicant's given name, their organisation, the programme and round, the
// portal link, and the award for an accepted decision. Nothing else about
// the application reaches a template.

import { contactDetails, organisationSummaries } from '@pixel-scientists/party/server';

import type { MergeValues, Outcome } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { money } from './read.ts';

export interface DecisionFacts {
  readonly outcome: Outcome;
  readonly amount_minor: string | null;
  readonly recipient_person_id: string;
  readonly organisation_id: string;
  readonly programme_title: string;
  readonly round_title: string;
}

/** The merge values for the decision's recipient, and the address to send to (null if they have none). */
export async function mergeValuesFor(
  tx: Tx,
  portalOrigin: string,
  facts: DecisionFacts,
): Promise<{ values: MergeValues; address: string | null }> {
  const contact = await contactDetails(tx, facts.recipient_person_id);
  const [organisation] = await organisationSummaries(tx, [facts.organisation_id]);
  return {
    address: contact?.email === undefined || contact.email === '' ? null : contact.email,
    values: {
      givenName: contact?.givenName ?? 'applicant',
      organisationName: organisation?.name ?? '',
      programmeTitle: facts.programme_title,
      roundTitle: facts.round_title,
      portalLink: portalOrigin,
      amount: facts.amount_minor === null ? null : money(facts.amount_minor),
    },
  };
}
