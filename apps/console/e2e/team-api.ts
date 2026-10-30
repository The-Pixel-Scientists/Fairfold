// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the team specs: a funder's team that keeps what an
// administrator does to it, and asks for step-up until the administrator has
// confirmed it is them, as the real routes do. Answers are plain JSON in the
// shape of the contracts in packages/domain/src/platform/team; the console
// checks each one against its contract.

import type { Page } from '@playwright/test';

import { northfield, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';

export interface Member {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
  status: 'active' | 'suspended';
}

export interface Invitation {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
}

/** The signed-in administrator, whose own row offers no actions. */
export const ada: Member = {
  id: northfield.id,
  name: 'Ada Morgan',
  email: 'ada@example.org',
  roles: ['tenant_admin'],
  status: 'active',
};

export const marcus: Member = {
  id: '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70',
  name: 'Marcus Bell',
  email: 'marcus@example.org',
  roles: ['programme_manager', 'reviewer'],
  status: 'active',
};

export const priya: Member = {
  id: '3f1e5a7b-9c2d-4e6f-8a1b-0c9d8e7f6a5b',
  name: null,
  email: 'priya@example.org',
  roles: ['reviewer'],
  status: 'suspended',
};

export const fatima: Invitation = {
  id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
  email: 'fatima@example.org',
  roles: ['reviewer'],
  expiresAt: '2026-11-04T17:00:00.000Z',
};

export interface TeamStub {
  members: Member[];
  invitations: Invitation[];
  /** Whether the administrator has confirmed it is them. Changes are refused until they have. */
  recent: boolean;
  sent: SentRequest[];
}

/** What the API says when an action needs a recent sign-in. */
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const ok = (body: unknown): Reply => ({ status: 200, body });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const administrator = ['platform.members.manage', 'platform.settings.manage'];

/** Applies a change to the stub's team, or says why it cannot be made. */
function change(stub: TeamStub, method: string, path: string, body: unknown): Reply {
  const roles = (body as { roles?: string[] } | undefined)?.roles ?? [];
  const member = (id: string | undefined) => stub.members.find((found) => found.id === id);
  const parts = path.split('/'); // ['', 'console', 'team', 'members' | 'invitations', id, action]
  const [, , , kind, id, action] = parts;

  if (kind === 'invitations' && id === undefined && method === 'POST') {
    const { email } = body as { email: string };
    if (stub.members.some((found) => found.email === email)) {
      return problem(409, 'This person is already on the team.');
    }
    const invitation = {
      id: uuid(stub.invitations.length + 100),
      email,
      roles,
      expiresAt: '2026-11-05T09:00:00.000Z',
    };
    stub.invitations = [...stub.invitations.filter((found) => found.email !== email), invitation];
    return { status: 201, body: invitation };
  }
  if (kind === 'invitations' && method === 'DELETE') {
    stub.invitations = stub.invitations.filter((found) => found.id !== id);
    return { status: 204 };
  }
  const target = member(id);
  if (kind !== 'members' || target === undefined || target.id === ada.id) {
    return problem(404, 'This person is not on the team.');
  }
  if (method === 'DELETE') {
    stub.members = stub.members.filter((found) => found.id !== id);
    return { status: 204 };
  }
  if (action === 'roles') target.roles = roles;
  if (action === 'suspend') target.status = 'suspended';
  if (action === 'reinstate') target.status = 'active';
  return ok(target);
}

/**
 * A signed-in administrator of a funder with this team. `more` replaces
 * answers, keyed like `GET /console/team`; `permissions` replaces the
 * administrator's.
 */
export async function stubTeam(
  page: Page,
  options: { members?: Member[]; invitations?: Invitation[]; recent?: boolean } = {},
  more: Record<string, Handler> = {},
  permissions: string[] = administrator,
): Promise<TeamStub> {
  const stub: TeamStub = {
    members: (options.members ?? [ada, marcus, priya]).map((found) => ({ ...found })),
    invitations: (options.invitations ?? [fatima]).map((found) => ({ ...found })),
    recent: options.recent ?? false,
    sent: [],
  };
  stub.sent = await stubSignedIn(
    page,
    { permissions },
    {
      'GET /console/settings': ok({
        name: 'Northfield Foundation',
        timeZone: 'Europe/London',
        fiscalYearStartMonth: 4,
      }),
      'POST /auth/step-up': () => {
        stub.recent = true;
        return ok({
          user: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' },
          expiresAt: '2099-01-01T00:00:00.000Z',
          app: 'console',
          mfa: 'complete',
          recentAuthUntil: '2099-01-01T00:00:00.000Z',
          activeMembership: { ...northfield, roles: ['tenant_admin'] },
          memberships: [{ ...northfield, roles: ['tenant_admin'] }],
          permissions: ['platform.members.manage', 'platform.settings.manage'],
        });
      },
      ...more,
    },
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/console/team'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const path = pathname.replace(/^\/api/, '');
      const body: unknown = request.postData() === null ? undefined : request.postDataJSON();
      stub.sent.push({ key: `${request.method()} ${path}`, body });
      const reply =
        request.method() === 'GET'
          ? ok({ members: stub.members, invitations: stub.invitations })
          : stub.recent
            ? change(stub, request.method(), path, body)
            : problem(403, STEP_UP_NEEDED);
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: reply.body === undefined ? undefined : JSON.stringify(reply.body),
      });
    },
  );
  return stub;
}
