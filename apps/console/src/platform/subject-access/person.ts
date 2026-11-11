// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPersonRecord } from '@pixel-scientists/crm/contracts';

import { callApi } from '../../api.ts';
import { isNotFound } from './common.tsx';

export type PersonRead =
  /** Their name, or their email address until they have one. */
  | { status: 'found'; name: string }
  /** Merged into another record, or already erased. */
  | { status: 'gone' }
  | { status: 'notFound' };

/** Reads the person to be named on the page. */
export async function loadPerson(personId: string): Promise<PersonRead> {
  try {
    const record = await callApi(getPersonRecord, { params: { personId } });
    if (record.state !== 'current') return { status: 'gone' };
    const { givenName, familyName, email } = record.person;
    return { status: 'found', name: [givenName, familyName].filter(Boolean).join(' ') || email };
  } catch (error) {
    if (isNotFound(error)) return { status: 'notFound' };
    throw error;
  }
}
