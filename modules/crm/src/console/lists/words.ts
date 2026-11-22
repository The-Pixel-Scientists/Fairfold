// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words for a segment's fields, comparisons and values.

import { identifierSchemes, legalForms, partyKinds } from '@pixel-scientists/party/contracts';

import { interactionKinds, partyStatuses } from '../../contracts/index.ts';
import type { SegmentField, SegmentOperator } from '../../contracts/index.ts';
import { interactionWords, kindWords, statusWords } from '../words.ts';

/** Fields a member can filter on. `contact_for` needs an organisation's id, so it is not offered. */
export const filterFields = [
  'kind',
  'status',
  'legal_form',
  'identifier_scheme',
  'list',
  'interaction_kind',
  'last_interaction',
  'created',
] as const satisfies readonly SegmentField[];

export type FilterField = (typeof filterFields)[number];

export const fieldLabels = {
  kind: 'Kind',
  status: 'Status',
  legal_form: 'Legal form',
  identifier_scheme: 'Identifier register',
  list: 'List',
  interaction_kind: 'Interaction',
  last_interaction: 'Last interaction',
  created: 'Created',
  contact_for: 'Contact for',
} as const satisfies Record<SegmentField, string>;

export const operatorLabels = {
  eq: 'is',
  ne: 'is not',
  has: 'has',
  lacks: 'does not have',
  has_verified: 'has verified',
  before: 'is before',
  after: 'is after',
} as const satisfies Record<SegmentOperator, string>;

export type Choice = readonly { value: string; label: string }[];

/** The values a field can be compared with, or null where the value is a date or a list. */
export function valueChoices(field: SegmentField): Choice | null {
  switch (field) {
    case 'kind':
      return partyKinds.map((value) => ({ value, label: kindWords[value] }));
    case 'status':
      return partyStatuses.map((value) => ({ value, label: statusWords[value] }));
    case 'legal_form':
      return Object.entries(legalForms).map(([value, label]) => ({ value, label }));
    case 'identifier_scheme':
      return Object.entries(identifierSchemes).map(([value, { label }]) => ({ value, label }));
    case 'interaction_kind':
      return interactionKinds.map((value) => ({ value, label: interactionWords[value] }));
    default:
      return null;
  }
}
