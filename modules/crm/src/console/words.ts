// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kinds, statuses, fields and dates in the words the screens use.

import { modules } from '@pixel-scientists/domain/platform';
import { identifierSchemes } from '@pixel-scientists/party/contracts';
import type { IdentifierScheme, ValueHistoryField } from '@pixel-scientists/party/contracts';

import type {
  InteractionKind,
  PartyStatus,
  SourceReference,
  VerificationState,
} from '../contracts/index.ts';

export const statusWords = {
  active: 'Active',
  archived: 'Archived',
  merged: 'Merged',
  erased: 'Erased',
} as const satisfies Record<PartyStatus, string>;

export const verificationWords = {
  verified: 'Verified',
  claimed: 'Unverified',
  none: 'No identifier',
} as const satisfies Record<VerificationState, string>;

export const kindWords = { organisation: 'Organisation', person: 'Person' } as const;

export const interactionWords = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  application_submitted: 'Application submitted',
  decision_released: 'Decision released',
} as const satisfies Record<InteractionKind, string>;

export const fieldWords = {
  'organisation.name': 'Name',
  'organisation.legal_form': 'Legal form',
  'organisation.address_line1': 'Address line 1',
  'organisation.address_line2': 'Address line 2',
  'organisation.address_town': 'Town or city',
  'organisation.address_postcode': 'Postcode',
  'organisation.address_country_code': 'Country',
  'organisation.website': 'Website',
  'organisation.identifier': 'Identifier',
  'person.given_name': 'First name',
  'person.family_name': 'Last name',
  'person.email': 'Email address',
  'person.phone': 'Phone number',
} as const satisfies Record<ValueHistoryField, string>;

export const schemeWords = (scheme: IdentifierScheme): string => identifierSchemes[scheme].label;

/** The tool's name, such as "Grants". */
export const moduleWords = (module: SourceReference['module']): string => modules[module].label;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "4 March 2024" for `2024-03-04`. */
export function formatDay(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

const moment = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "4 March 2024 at 9am" in the browser's time zone, which is the member's own. */
export function formatMoment(iso: string): string {
  const parts = Object.fromEntries(
    moment.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]),
  );
  const minutes = parts['minute'] === '00' ? '' : `:${parts['minute'] ?? ''}`;
  const period = (parts['dayPeriod'] ?? '').toLowerCase();
  return `${parts['day'] ?? ''} ${parts['month'] ?? ''} ${parts['year'] ?? ''} at ${parts['hour'] ?? ''}${minutes}${period}`;
}

/** A person's name, or their email address until they have one. */
export function personName(person: {
  givenName: string | null;
  familyName: string | null;
  email: string;
}): string {
  const name = [person.givenName, person.familyName].filter(Boolean).join(' ');
  return name === '' ? person.email : name;
}
