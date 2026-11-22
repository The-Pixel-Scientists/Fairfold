// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the teams specs: teams that keep what an
// administrator does to them, and ask for step-up until the administrator has
// confirmed it is them, as the real routes do. Answers are plain JSON in the
// shape of the contracts in packages/domain/src/platform/team.

import type { Page } from '@playwright/test';

import { northfield, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';
import { ada, marcus, priya } from './team-api.ts';

export interface Team {
  id: string;
  name: string;
  archivedAt: string | null;
  /** Membership ids. */
  members: string[];
}

export const casework: Team = {
  id: '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8',
  name: 'Casework',
  archivedAt: null,
  members: [ada.id, priya.id],
};

export const legacy: Team = {
  id: '6c2d3e4f-5061-4b72-9c83-a4b5c6d7e8f9',
  name: 'Legacy panel',
  archivedAt: '2026-10-01T09:00:00.000Z',
  members: [],
};

export interface TeamsStub {
  teams: Team[];
  recent: boolean;
  sent: SentRequest[];
}

/** What the API says when an action needs a recent sign-in. */
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const ok = (body: unknown): Reply => ({ status: 200, body });
const people = [ada, marcus, priya];
const permissions = ['platform.teams.manage', 'platform.members.manage'];
const notFound = () => problem(404, 'This page was not found.');

const summary = ({ members, ...team }: Team) => ({ ...team, memberCount: members.length });
const detail = (team: Team) => ({
  ...summary(team),
  members: team.members.map((membershipId) => {
    const person = people.find(({ id }) => id === membershipId);
    return { membershipId, name: person?.name ?? null, status: person?.status ?? 'active' };
  }),
});

/** Applies a change to the stub's teams, or says why it cannot be made. */
function change(stub: TeamsStub, method: string, path: string, body: unknown): Reply {
  // ['', 'console', 'teams', id, 'members' | 'archive', membershipId]
  const [, , , id, kind, membershipId] = path.split('/');
  const name = (body as { name?: string } | undefined)?.name;
  if (id === undefined && method === 'POST') {
    if (stub.teams.some((team) => team.archivedAt === null && team.name === name)) {
      return problem(409, 'A team with this name already exists.', [
        { field: 'body.name', message: 'Choose a name no active team uses.' },
      ]);
    }
    const team = {
      id: `00000000-0000-4000-8000-${String(stub.teams.length + 100).padStart(12, '0')}`,
      name: name ?? '',
      archivedAt: null,
      members: [],
    };
    stub.teams.push(team);
    return { status: 201, body: summary(team) };
  }
  const team = stub.teams.find((found) => found.id === id);
  if (team === undefined) return notFound();
  if (method === 'PATCH') team.name = name ?? team.name;
  if (kind === 'archive') team.archivedAt = '2026-11-20T09:00:00.000Z';
  if (kind === 'members' && method === 'PUT' && membershipId !== undefined) {
    team.members.push(membershipId);
    return { status: 204 };
  }
  if (kind === 'members' && method === 'DELETE') {
    team.members = team.members.filter((found) => found !== membershipId);
    return { status: 204 };
  }
  return ok(summary(team));
}

function read(stub: TeamsStub, id: string | undefined): Reply {
  if (id === undefined) return ok({ teams: stub.teams.map(summary) });
  const team = stub.teams.find((found) => found.id === id);
  return team === undefined ? notFound() : ok(detail(team));
}

/**
 * A signed-in administrator of a funder with these teams. `more` replaces
 * answers, keyed like `GET /console/team`; `allowed` replaces the
 * administrator's permissions.
 */
export async function stubTeams(
  page: Page,
  options: { teams?: Team[]; recent?: boolean } = {},
  more: Record<string, Handler> = {},
  allowed: string[] = permissions,
): Promise<TeamsStub> {
  const stub: TeamsStub = {
    teams: (options.teams ?? [casework, legacy]).map((team) => ({
      ...team,
      members: [...team.members],
    })),
    recent: options.recent ?? false,
    sent: [],
  };
  stub.sent = await stubSignedIn(
    page,
    { permissions: allowed },
    {
      'GET /console/team': ok({ members: people, invitations: [] }),
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
          permissions: allowed,
          modules: ['grants'],
        });
      },
      ...more,
    },
  );

  await page.route(
    (url) => url.pathname.startsWith('/api/console/teams'),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, '');
      const body: unknown = request.postData() === null ? undefined : request.postDataJSON();
      stub.sent.push({ key: `${request.method()} ${path}`, body });
      const reply =
        request.method() === 'GET'
          ? read(stub, path.split('/')[3])
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
