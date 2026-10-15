// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers: the party routes' answers, checked against their contracts so
// a fixture cannot drift from them. Not part of the app.

import {
  portalOrganisationListSchema,
  portalOrganisationSchema,
  profileSchema,
} from '@pixel-scientists/party/contracts';
import type { Consent, PortalOrganisation, Profile } from '@pixel-scientists/party/contracts';

import { applicantSession } from './api.ts';
import type { Reply } from './api.ts';

export const ORGANISATION_ID = '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55';
export const OTHER_ORGANISATION_ID = '7d2e9a64-1b3c-4d5e-8f6a-0b1c2d3e4f5a';

export const signedIn = { 'GET /auth/session': { status: 200, body: applicantSession() } };

export function profile(overrides: Partial<Profile> = {}): Profile {
  return profileSchema.parse({
    givenName: 'Ada',
    familyName: 'Lovelace',
    email: 'ada@example.org',
    phone: null,
    consents: [],
    ...overrides,
  });
}

/** The latest choice about being emailed about future funding, made on 5 October 2026. */
export function consent(state: Consent['state']): Consent {
  return {
    purpose: 'future_funding',
    channel: 'email',
    state,
    privacyNoticeVersion: '1.0',
    recordedAt: '2026-10-05T12:00:00.000Z',
  };
}

export const newProfile = profile({ givenName: null, familyName: null });

export function organisation(overrides: Partial<PortalOrganisation> = {}): PortalOrganisation {
  return portalOrganisationSchema.parse({
    id: ORGANISATION_ID,
    name: 'Eastmere Community Garden',
    legalForm: 'registered_charity',
    identifiers: [{ scheme: 'GB-CHC', identifier: '1187654' }],
    registeredAddress: {
      line1: '12 Mill Lane',
      line2: null,
      town: 'Eastmere',
      postcode: 'EA1 2ST',
      countryCode: 'GB',
    },
    website: null,
    ...overrides,
  });
}

export function ok(body: unknown): Reply {
  return { status: 200, body };
}

export function created(body: unknown): Reply {
  return { status: 201, body };
}

/** The list of organisations an applicant can see, as the API sends it: id, name and legal form. */
export function organisationList(...organisations: PortalOrganisation[]): Reply {
  return ok(
    portalOrganisationListSchema.parse({
      organisations: organisations.map(({ id, name, legalForm }) => ({ id, name, legalForm })),
    }),
  );
}
