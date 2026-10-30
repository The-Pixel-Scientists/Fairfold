// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Applicants who apply through the API's own routes, so the journey has
// enough submissions to triage, review and decide without every one of them
// working through the pages: step 8 does that once, as a person does.

import { accountsPdf } from '../fixtures/files.ts';
import type { Api } from './api.ts';
import { createApplicantAccount } from './applicants.ts';
import { need, updateState } from './state.ts';

export interface Applicant {
  /** The name the state holds them under. */
  name: string;
  givenName: string;
  familyName: string;
  organisation: string;
  charityNumber: string;
  address: { line1: string; town: string; postcode: string };
  /** Pounds asked for, and the costs that make it up. */
  costs: readonly [item: string, pounds: number, kind: 'Staff' | 'Equipment'][];
  projectWords: string;
}

/** The six groups that apply through the API: five submit, and the sixth withdraws. */
export const groups: Applicant[] = [
  ['applicant2', 'Grace', 'Okafor', 'Westgate Village Hall', '1203344', 'NF2 4HL'],
  ['applicant3', 'Tom', 'Bradley', 'Brook Street Youth Club', '1203345', 'NF3 5JS'],
  ['applicant4', 'Anita', 'Verma', 'Friends of Elm Park', '1203346', 'NF1 6QP'],
  ['applicant5', 'Joe', 'Marsh', 'Northgate Allotment Society', '1203347', 'NF4 7RT'],
  ['applicant6', 'Lena', 'Kovacs', 'Mill Lane Music Group', '1203348', 'NF5 8WX'],
  ['applicant7', 'Femi', 'Adeyemi', 'Harbour Sailing Club', '1203349', 'NF6 9ZA'],
].map(
  (
    [
      name = '',
      givenName = '',
      familyName = '',
      organisation = '',
      charityNumber = '',
      postcode = '',
    ],
    index,
  ) => ({
    name,
    givenName,
    familyName,
    organisation,
    charityNumber,
    address: { line1: `${String(index + 2)} Westgate`, town: 'Northfield', postcode },
    costs: [
      ['Equipment', 3000 + index * 500, 'Equipment'],
      ['Staff time', 3000 + index * 250, 'Staff'],
    ],
    projectWords: `We will use the grant to open our doors to more neighbours, plan ${String(index + 1)}.`,
  }),
);

interface Field {
  id: string;
  type: string;
  label: string;
  columns?: { id: string; type: string; label: string; options?: { value: string }[] }[];
}

interface Application {
  id: string;
  answersVersion: number;
}

const money = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' });

/** An answer to a table column, by what the column holds. */
function cell(
  column: NonNullable<Field['columns']>[number],
  [item, pounds, kind]: Applicant['costs'][number],
): unknown {
  if (column.type === 'currency') return money(pounds);
  if (column.type === 'dropdown') {
    return kind === 'Staff' ? column.options?.[0]?.value : column.options?.[1]?.value;
  }
  return item;
}

/** Answers for every question of the demo form but the file, from the applicant's details. */
export function answersFor(
  fields: readonly Field[],
  applicant: Applicant,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  const total = applicant.costs.reduce((sum, [, pounds]) => sum + pounds, 0);
  for (const field of fields) {
    if (field.type === 'file' || field.type === 'content') continue;
    if (field.type === 'yes_no') answers[field.id] = true;
    else if (field.type === 'email') answers[field.id] = `hello@${applicant.charityNumber}.example`;
    else if (field.type === 'currency') answers[field.id] = money(total);
    else if (field.type === 'long_text') answers[field.id] = applicant.projectWords;
    else if (field.type === 'short_text') {
      answers[field.id] = /charity number/i.test(field.label)
        ? applicant.charityNumber
        : applicant.organisation;
    } else if (field.type === 'table') {
      answers[field.id] = applicant.costs.map((row) =>
        Object.fromEntries((field.columns ?? []).map((column) => [column.id, cell(column, row)])),
      );
    } else throw new Error(`The demo form has a ${field.type} question the journey cannot answer.`);
  }
  return answers;
}

/** An applicant with an account, a name and an organisation, who has not started an application. */
export async function applicantWithOrganisation(
  applicant: Applicant,
): Promise<{ api: Api; organisationId: string }> {
  const api = await createApplicantAccount(applicant.name);
  await api.ok('PUT', '/portal/profile', {
    json: { givenName: applicant.givenName, familyName: applicant.familyName },
  });
  const organisation = await api.ok<{ id: string }>('POST', '/portal/organisations', {
    json: {
      name: applicant.organisation,
      legalForm: 'registered_charity',
      identifiers: [{ scheme: 'GB-CHC', identifier: applicant.charityNumber }],
      registeredAddress: applicant.address,
    },
  });
  return { api, organisationId: organisation.id };
}

/**
 * Signs the applicant up, completes their details and organisation, starts an
 * application for the round, answers it, attaches the accounts and submits it.
 * Gives their API session and the application's id; both go in the state.
 */
export async function applyThroughTheApi(
  applicant: Applicant,
): Promise<{ api: Api; applicationId: string }> {
  const { api, organisationId } = await applicantWithOrganisation(applicant);
  const roundId = need('roundId');
  const round = await api.ok<{ form: { definition: { sections: { fields: Field[] }[] } } }>(
    'GET',
    `/portal/rounds/${roundId}`,
  );
  const fields = round.form.definition.sections.flatMap((section) => section.fields);
  const started = await api.ok<Application>('POST', `/portal/rounds/${roundId}/applications`, {
    json: { organisationId },
  });
  await api.ok('PUT', `/portal/applications/${started.id}/answers`, {
    json: { basedOn: started.answersVersion, answers: answersFor(fields, applicant) },
  });
  // The pages check eligibility as the eligibility questions are answered; so does this.
  await api.ok('POST', `/portal/applications/${started.id}/eligibility-check`);
  await api.ok(
    'POST',
    `/portal/applications/${started.id}/fields/${need('accountsFieldId')}/files`,
    {
      file: { name: 'accounts-2026.pdf', bytes: accountsPdf() },
    },
  );
  const current = await api.ok<Application>('GET', `/portal/applications/${started.id}`);
  await api.ok('POST', `/portal/applications/${started.id}/submit`, {
    json: { basedOn: current.answersVersion },
  });
  updateState((state) => {
    state.ids[`${applicant.name}ApplicationId`] = started.id;
    state.ids[`${applicant.name}OrganisationId`] = organisationId;
  });
  return { api, applicationId: started.id };
}
