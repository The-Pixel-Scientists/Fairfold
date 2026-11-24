// SPDX-License-Identifier: AGPL-3.0-or-later
//
// privacy in the all-tools funder: an administrator records a rights request
// for a seeded synthetic person, sees the due date, stops and restarts the clock
// with reason codes, and adds and completes a task. Each change is one audit
// event. Starting the export asks for step-up, and the file is the requester's
// alone: another member of the same funder cannot download it (404).
//
// The export start and status routes are not wired into the API yet (the platform
// has no subject access request handler or export job), so the export tests skip,
// saying so, and run once the routes answer.

import { randomUUID } from 'node:crypto';

import type { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { readyFile } from '../triage/steps.ts';
import {
  ABSENT,
  asSlug,
  auditReader,
  jsonOf,
  call,
  confirmAgain,
  echoesNothing,
  eventsAbout,
  expect,
  forgedKeys,
  keyed,
  membershipOf,
  onWave1,
  signInAs,
  staffName,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
const DAY = 86_400_000;

interface Clock {
  state: string;
  dueOn: string | null;
}

interface Request {
  id: string;
  personId: string;
  clock: Clock;
  clockEvents: { kind: string; reason: string; membershipId: string }[];
  exportRequestId: string | null;
}

let admin: Api;
let manager: Api;
let reader: Api;
let personId = '';
let requestId = '';
let exportMissing = false;

const today = () => new Date().toISOString().slice(0, 10);
const route = (suffix = '') => `/console/rights-requests/${requestId}${suffix}`;
const read = async () => await jsonOf<Request>(call(admin, 'GET', route()));

test.describe('privacy: a rights request, its clock, its tasks and its export', () => {
  test.beforeAll(async () => {
    admin = await signInAs(slug, 'tenant_admin');
    manager = await signInAs(slug, 'programme_manager');
    reader = await auditReader(slug);
  });

  test.afterAll(async () => {
    await Promise.all([admin.dispose(), manager.dispose(), reader.dispose()]);
  });

  test('a programme manager is denied the requests, and a forged key is refused', async () => {
    expect((await call(manager, 'GET', '/console/rights-requests')).status).toBe(403);

    const { results } = await jsonOf<{ results: { id: string }[] }>(
      call(manager, 'POST', '/console/crm/search', { term: 'Dunholt', kinds: ['person'] }),
    );
    personId = results[0]?.id ?? '';
    expect(personId).toMatch(/^[0-9a-f-]{36}$/);

    const request = {
      personId,
      receivedAt: new Date(Date.now() - 3 * DAY).toISOString(),
      kind: 'access',
      channel: 'email',
      summary: 'Asks for a copy of what we hold about them.',
      identityCheck: 'not_started',
    };
    for (const key of forgedKeys) {
      const forged = await keyed(admin, 'POST', '/console/rights-requests', {
        ...request,
        [key]: ABSENT,
      });
      expect(forged.status, key).toBe(400);
    }

    const key = randomUUID();
    const made = await jsonOf<Request>(
      keyed(admin, 'POST', '/console/rights-requests', request, key),
      201,
    );
    requestId = made.id;
    const again = await keyed(admin, 'POST', '/console/rights-requests', request, key);
    expect((again.json as Request).id).toBe(requestId);
    expect(made.clock.state).toBe('running');
    expect(made.clock.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      await eventsAbout(reader, slug, 'privacy.rights_request.created', requestId),
    ).toHaveLength(1);
    const { requests } = await jsonOf<{ requests: { id: string }[] }>(
      call(admin, 'GET', '/console/rights-requests'),
    );
    expect(requests.filter(({ id }) => id === requestId)).toHaveLength(1);
  });

  test('stopping the clock takes away the due date, and restarting it brings the date back', async ({
    pages,
  }) => {
    const due = (await read()).clock.dueOn;
    const paused = await jsonOf<Request>(
      keyed(admin, 'POST', route('/pause'), { on: today(), reason: 'identity_proof' }),
    );
    expect(paused.clock).toEqual({ state: 'paused', dueOn: null });

    const page = await pages.staff(staffName(slug, 'tenant_admin'), asSlug(slug));
    await axePages(page, [`/${slug}/privacy?view=request&id=${requestId}`]);
    await expect(
      page.getByText('The due date is not known until the clock restarts.'),
    ).toBeVisible();

    const resumed = await jsonOf<Request>(
      keyed(admin, 'POST', route('/resume'), { on: today(), reason: 'information_received' }),
    );
    expect(resumed.clock.state).toBe('running');
    expect(resumed.clock.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resumed.clock.dueOn !== null && due !== null && resumed.clock.dueOn >= due).toBe(true);
    expect(resumed.clockEvents.map(({ kind, reason }) => `${kind}:${reason}`)).toEqual([
      'paused:identity_proof',
      'resumed:information_received',
    ]);

    const me = await membershipOf(admin);
    for (const action of ['privacy.rights_request.paused', 'privacy.rights_request.resumed']) {
      const events = await eventsAbout(reader, slug, action, requestId);
      expect(events, action).toHaveLength(1);
      expect(events[0]?.actor.membershipId).toBe(me);
    }
  });

  test('a task is added and completed, each as one event, and an invented reason code is refused', async () => {
    const refused = await keyed(admin, 'POST', route('/pause'), { on: today(), reason: 'because' });
    expect(refused.status).toBe(400);

    const task = await jsonOf<{ id: string; completedAt: string | null }>(
      keyed(admin, 'POST', route('/tasks'), {
        title: 'Check the finance records',
        assigneeMembershipId: null,
        moduleId: null,
        dueOn: null,
      }),
      201,
    );
    expect(task.completedAt).toBeNull();
    const done = await jsonOf<{ completedAt: string | null }>(
      keyed(admin, 'POST', route(`/tasks/${task.id}/completion`)),
    );
    expect(done.completedAt).not.toBeNull();
    for (const action of ['privacy.request_task.created', 'privacy.request_task.completed']) {
      expect(await eventsAbout(reader, slug, action, task.id), action).toHaveLength(1);
    }
    const { tasks } = await jsonOf<{ tasks: { id: string }[] }>(
      call(admin, 'GET', route('/tasks')),
    );
    expect(tasks.map(({ id }) => id)).toEqual([task.id]);
  });

  test('exporting asks for step-up, reaches the requester only, and is read back as events', async () => {
    const probe = await keyed(admin, 'POST', route('/export'));
    if (probe.status === 404) {
      exportMissing = true;
    } else {
      expect(probe.status, 'the export asks for step-up first').toBe(403);
    }
    test.skip(
      exportMissing,
      'The export start and status routes are not wired into the API (the platform has no subject access request handler or export job yet). Owner: api-builder with db-security.',
    );

    await confirmAgain(admin, slug, 'tenant_admin');
    const started = await keyed(admin, 'POST', route('/export'));
    expect(started.status).toBe(202);
    const fileId = await readyFile(admin, route('/export'));

    expect((await admin.send('GET', `/console/files/${fileId}`)).status).toBe(200);
    const other = await call(manager, 'GET', `/console/files/${fileId}`);
    expect(other.status).toBe(404);
    expect(echoesNothing(other, fileId)).toBe(true);

    expect(
      await eventsAbout(reader, slug, 'privacy.rights_request.export_started', requestId),
    ).toHaveLength(1);
    expect((await read()).exportRequestId).not.toBeNull();
  });
});
