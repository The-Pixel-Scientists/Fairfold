// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the profile specs: an applicant who keeps what
// is saved, so a spec can change something and see it afterwards. Answers are
// plain JSON in the shape of the party contracts
// (modules/party/src/contracts); the portal checks each one against its contract.

import type { Page } from '@playwright/test';

import { applicantSession, standard, stubApi } from './auth-api.ts';
import type { Funder, Handler, SentRequest, SessionOptions } from './auth-api.ts';

export const ORGANISATION_ID = '3c1b8d52-6f0a-4e0e-9f0b-7a6f2d1c4b55';
const NEW_ORGANISATION_ID = '7d2e9a64-1b3c-4d5e-8f6a-0b1c2d3e4f5a';
const SIGN_IN_EMAIL = 'ada@example.org';

export interface Organisation {
  id: string;
  name: string;
  legalForm: string;
  identifiers: { scheme: string; identifier: string }[];
  registeredAddress: {
    line1: string;
    line2: string | null;
    town: string;
    postcode: string;
    countryCode: string;
  };
  website: string | null;
}

export interface Consent {
  purpose: 'future_funding';
  channel: 'email';
  state: 'given' | 'withdrawn';
  privacyNoticeVersion: string;
  recordedAt: string;
}

export interface Applicant {
  givenName: string | null;
  familyName: string | null;
  phone: string | null;
  consents: Consent[];
  organisations: Organisation[];
}

/** An applicant who has just created an account: nothing is filled in. */
export const newApplicant = (): Applicant => ({
  givenName: null,
  familyName: null,
  phone: null,
  consents: [],
  organisations: [],
});

export const garden: Organisation = {
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
};

/** An applicant who has done everything. */
export const settledApplicant = (): Applicant => ({
  givenName: 'Ada',
  familyName: 'Lovelace',
  phone: '01632 960 001',
  consents: [
    {
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacyNoticeVersion: '1.0',
      recordedAt: '2026-10-05T12:00:00.000Z',
    },
  ],
  organisations: [garden],
});

export interface ApplicantStub {
  /** What is saved. A spec may change it between steps. */
  applicant: Applicant;
  sent: SentRequest[];
}

const ok = (body: unknown) => ({ status: 200, body });

/**
 * A signed-in applicant, in the funder's look, whose profile, organisations
 * and choices are kept. `more` adds or replaces answers, keyed like
 * `GET /portal/profile`.
 */
export async function stubApplicant(
  page: Page,
  start: Applicant = newApplicant(),
  more: Record<string, Handler> = {},
  funder: Funder = standard,
  session: SessionOptions = {},
): Promise<ApplicantStub> {
  const applicant: Applicant = structuredClone(start);
  // Answers are added to this as organisations are added, so the stub must read it, not a copy.
  const handlers: Record<string, Handler> = {
    'GET /auth/session': { status: 200, body: applicantSession(session) },
    'POST /auth/sign-out': { status: 204 },
  };
  const profile = () => ({
    givenName: applicant.givenName,
    familyName: applicant.familyName,
    email: session.email ?? SIGN_IN_EMAIL,
    phone: applicant.phone,
    consents: applicant.consents,
  });

  /** Answers for one organisation by its address, which is not known until it is added. */
  function addOrganisation(organisation: Organisation) {
    handlers[`GET /portal/organisations/${organisation.id}`] = () =>
      ok(applicant.organisations.find(({ id }) => id === organisation.id));
    handlers[`PUT /portal/organisations/${organisation.id}`] = (body) => {
      const changed = applicant.organisations.find(({ id }) => id === organisation.id);
      return ok(Object.assign(changed ?? {}, fromInput(body)));
    };
  }
  applicant.organisations.forEach(addOrganisation);

  Object.assign(handlers, {
    'GET /portal/profile': () => ok(profile()),
    'PUT /portal/profile': (body) => {
      const { givenName, familyName, phone } = body as {
        givenName: string;
        familyName: string;
        phone?: string;
      };
      Object.assign(applicant, { givenName, familyName, phone: phone === '' ? null : phone });
      return ok(profile());
    },
    'POST /portal/profile/consents': (body) => {
      const { state, privacyNoticeVersion } = body as Pick<
        Consent,
        'state' | 'privacyNoticeVersion'
      >;
      const consent: Consent = {
        purpose: 'future_funding',
        channel: 'email',
        state,
        privacyNoticeVersion,
        recordedAt: '2026-10-07T09:30:00.000Z',
      };
      applicant.consents = [consent];
      return { status: 201, body: consent };
    },
    'GET /portal/organisations': () =>
      ok({
        organisations: applicant.organisations.map(({ id, name, legalForm }) => ({
          id,
          name,
          legalForm,
        })),
      }),
    'POST /portal/organisations': (body) => {
      const organisation: Organisation = { id: NEW_ORGANISATION_ID, ...fromInput(body) };
      applicant.organisations.push(organisation);
      addOrganisation(organisation);
      return { status: 201, body: organisation };
    },
    ...more,
  } satisfies Record<string, Handler>);

  const sent = await stubApi(page, handlers, funder);
  return { applicant, sent };
}

/** What the API keeps of an organisation the portal sent: the same, with the address as stored. */
function fromInput(body: unknown): Omit<Organisation, 'id'> {
  const input = body as Omit<Organisation, 'id' | 'website' | 'registeredAddress'> & {
    website?: string;
    registeredAddress: Omit<Organisation['registeredAddress'], 'line2'> & { line2?: string };
  };
  const { line2, ...address } = input.registeredAddress;
  return {
    name: input.name,
    legalForm: input.legalForm,
    identifiers: input.identifiers,
    registeredAddress: { ...address, line2: line2 === undefined || line2 === '' ? null : line2 },
    website: input.website === undefined || input.website === '' ? null : input.website,
  };
}
