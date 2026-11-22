// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the privacy screen specs: synthetic people and
// records in the shape of the contracts in modules/privacy/src/contracts,
// which the console checks every answer against. Anything a spec changes is
// kept in the stub, so what the screen shows afterwards is what was sent.

import type { Page } from '@playwright/test';

import { northfield, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

/** Today in the specs that fix the clock: the day the running request has 8 days left. */
export const TODAY = '2027-01-04T10:00:00.000Z';

export const permissions = [
  'privacy.requests.manage',
  'privacy.requests.export',
  'privacy.requests.erase',
  'privacy.breaches.manage',
  'privacy.dpias.manage',
  'privacy.processing.manage',
  'party.records.read',
  'platform.settings.manage',
];

export const person = { id: uid(900), givenName: 'Sam', familyName: 'Taylor' };

const stamps = { createdAt: '2027-01-02T09:00:00.000Z', updatedAt: '2027-01-02T09:00:00.000Z' };

export interface RequestFixture {
  id: string;
  kind: string;
  personId: string;
  receivedAt: string;
  receivedOn: string;
  channel: string;
  summary: string;
  identityCheck: string;
  clock: { state: string; dueOn: string | null };
  clockEvents: unknown[];
  exportRequestId: string | null;
  erasureRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rightsRequest(n: number, changes: Partial<RequestFixture> = {}): RequestFixture {
  return {
    id: uid(n),
    kind: 'access',
    personId: person.id,
    receivedAt: '2026-12-12T09:00:00.000Z',
    receivedOn: '2026-12-12',
    channel: 'email',
    summary: 'Asked for a copy of everything held about them.',
    identityCheck: 'verified',
    clock: { state: 'running', dueOn: '2027-01-12' },
    clockEvents: [],
    exportRequestId: null,
    erasureRequestId: null,
    ...stamps,
    ...changes,
  };
}

const listed = ({
  id,
  kind,
  personId,
  receivedOn,
  channel,
  identityCheck,
  clock,
}: RequestFixture) => ({
  id,
  kind,
  personId,
  receivedOn,
  channel,
  identityCheck,
  clock,
});

/** One request in each clock state. */
export const requests = [
  rightsRequest(1),
  rightsRequest(2, { kind: 'erasure', clock: { state: 'overdue', dueOn: '2027-01-01' } }),
  rightsRequest(3, {
    kind: 'rectification',
    identityCheck: 'requested',
    clock: { state: 'paused', dueOn: null },
    clockEvents: [
      {
        kind: 'paused',
        on: '2027-01-04',
        reason: 'identity_proof',
        membershipId: northfield.id,
        recordedAt: '2027-01-04T09:00:00.000Z',
      },
    ],
  }),
  rightsRequest(4, { kind: 'portability', clock: { state: 'extended', dueOn: '2027-03-12' } }),
  rightsRequest(5, { kind: 'objection', clock: { state: 'closed', dueOn: '2027-01-12' } }),
];

export const breach = (changes: Record<string, unknown> = {}) => ({
  id: uid(300),
  becameAwareAt: '2026-12-06T15:15:00.000Z',
  discoveredAt: '2026-12-06T14:00:00.000Z',
  description: 'A spreadsheet of applicant emails was sent to the wrong address.',
  dataCategories: ['contact', 'health'],
  specialCategory: true,
  approximateSubjects: 12,
  approximateRecords: 12,
  likelyConsequences: 'Some people may get unwanted email.',
  measuresTaken: 'Asked the recipient to delete it.',
  clock: { deadline: '2026-12-09T15:15:00.000Z', hoursRemaining: 47, late: false },
  assessments: [],
  icoNotification: null,
  subjectNotification: null,
  ...stamps,
  ...changes,
});

export const dpia = (changes: Record<string, unknown> = {}) => ({
  id: uid(400),
  title: 'Mailing list move',
  status: 'draft',
  processingActivityIds: [],
  screening: {},
  risks: [],
  dpoAdvice: '',
  signOff: null,
  ...stamps,
  ...changes,
});

const ok = (body: unknown): Reply => ({ status: 200, body });

/** The session after step-up, which makes the next export or erasure succeed. */
const steppedUp = {
  user: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' },
  expiresAt: '2099-01-01T00:00:00.000Z',
  app: 'console',
  mfa: 'complete',
  recentAuthUntil: '2099-01-01T00:00:00.000Z',
  activeMembership: { ...northfield, roles: ['tenant_admin'] },
  memberships: [{ ...northfield, roles: ['tenant_admin'] }],
  permissions,
  modules: ['grants', 'privacy'],
};

export interface PrivacyStub {
  sent: SentRequest[];
  /** Whether the member has confirmed it is them. */
  recent: boolean;
}

/** The first request in `sent` with this key, or undefined. */
export const sentWith = (stub: PrivacyStub, key: string) =>
  stub.sent.find((request) => request.key === key);

/**
 * A signed-in member of a funder with the privacy tool on. `more` replaces or
 * adds answers, keyed like `GET /console/rights-requests`. Actions that need
 * step-up are refused until `POST /auth/step-up` has been answered.
 */
export async function stubPrivacy(
  page: Page,
  options: { permissions?: string[]; modules?: string[] } = {},
  more: Record<string, Handler> = {},
): Promise<PrivacyStub> {
  const stub: PrivacyStub = { sent: [], recent: false };
  const needsStepUp =
    (reply: Reply): Handler =>
    () =>
      stub.recent ? reply : problem(403, STEP_UP_NEEDED);
  const sent = await stubSignedIn(
    page,
    {
      permissions: options.permissions ?? permissions,
      modules: options.modules ?? ['grants', 'privacy'],
    },
    {
      'GET /console/settings': ok({
        name: 'Northfield Foundation',
        timeZone: 'Europe/London',
        fiscalYearStartMonth: 4,
      }),
      'GET /console/team': ok({
        members: [
          {
            id: northfield.id,
            name: 'Ada Morgan',
            email: 'ada@example.org',
            roles: ['tenant_admin'],
            status: 'active',
          },
        ],
        invitations: [],
      }),
      [`GET /console/people/${person.id}`]: ok({
        ...person,
        email: 'sam@example.org',
        phone: null,
        organisations: [],
        consents: [],
      }),
      'POST /auth/step-up': () => {
        stub.recent = true;
        return ok(steppedUp);
      },
      'GET /console/rights-requests': ok({ requests: requests.map(listed), nextCursor: null }),
      ...Object.fromEntries(
        requests.flatMap((request): [string, Handler][] => [
          [`GET /console/rights-requests/${request.id}`, ok(request)],
          [`GET /console/rights-requests/${request.id}/tasks`, ok({ tasks: [] })],
        ]),
      ),
      [`POST /console/rights-requests/${uid(1)}/export`]: needsStepUp({
        status: 202,
        body: { requestId: uid(700) },
      }),
      [`POST /console/rights-requests/${uid(2)}/erasure`]: needsStepUp({
        status: 202,
        body: { requestId: uid(701) },
      }),
      ...more,
    },
  );
  stub.sent = sent;
  return stub;
}
