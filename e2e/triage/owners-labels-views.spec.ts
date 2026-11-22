// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owners, labels and saved views. A bulk owner change and a bulk label change
// apply to exactly the submissions chosen, each audited, and leave a third
// submission alone. A saved view is reopened in the console with its filter
// restored, and Back returns to it. The second funder gets "not found" for
// the first funder's note, message, owner, label and view routes, and for a
// request that names a tenant or an actor (rule 6).
//
// It reads what the journey left, so it runs after the journey.

import {
  openOneAndReturn,
  openSubmissions,
  submissionRows,
} from '../../apps/console/e2e/submissions-steps.ts';
import { signInStaff, stepUp, type Api } from '../support/api.ts';
import { auditEvents } from '../support/audit.ts';
import { need } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import { ABSENT_ID } from '../platform/modules/routes.ts';
import { auditReader, call, create, made, membershipIdOf, needsJourney } from './steps.ts';

inOrder();
needsJourney();

const RUN = String(Date.now());

let manager: Api;
let reader: Api;
let labelId = '';
let ownerId = '';
const chosen = () => [need('application1Id'), need('applicant2ApplicationId')];
const untouched = () => need('applicant3ApplicationId');

const keyOf = (event: { entityId: string; occurredAt: string }) =>
  `${event.entityId}@${event.occurredAt}`;

/** The events of an action that exist now, so a later read can tell which are new. */
const seen = async (action: string): Promise<Set<string>> =>
  new Set((await auditEvents(reader, { action })).map(keyOf));

/** The ids of the records an action was recorded against since `before`. */
async function changedSince(action: string, before: Set<string>): Promise<string[]> {
  return (await auditEvents(reader, { action }))
    .filter((event) => !before.has(keyOf(event)))
    .map(({ entityId }) => entityId);
}

const viewBody = (name: string, status: 'withdrawn' | null) => ({
  name,
  filter: status === null ? {} : { status },
  sort: { by: 'submittedAt', direction: 'desc' },
  columns: [{ kind: 'column', id: 'organisation' }],
});

test.describe('owners, labels and saved views', () => {
  test.beforeAll(async () => {
    manager = await signInStaff('northfield', 'manager');
    reader = await auditReader();
    ownerId = await membershipIdOf(reader, 'manager');
    const label = await made<{ id: string }>(
      create(manager, '/console/labels', { name: `qzx call ${RUN}`, colour: 'info' }),
    );
    labelId = label.id;
  });

  test.afterAll(async () => {
    if (labelId !== '') await manager.send('POST', `/console/labels/${labelId}/archive`);
    await Promise.all([manager.dispose(), reader.dispose()]);
  });

  test('a bulk owner change applies to exactly the chosen submissions, each audited', async () => {
    const before = await seen('grants.application.owner_changed');
    const result = await made<{ changed: number }>(
      call(manager, 'POST', '/console/submission-owners', {
        submissionIds: chosen(),
        ownerId,
      }),
      200,
    );
    expect(result.changed).toBe(2);
    const touched = await changedSince('grants.application.owner_changed', before);
    expect([...touched].sort()).toEqual([...chosen()].sort());
    expect(touched).not.toContain(untouched());
  });

  test('a bulk label change applies to exactly the chosen submissions, each audited', async () => {
    const before = await seen('grants.application.labels_changed');
    const change = { submissionIds: chosen(), add: [labelId] };
    const result = await made<{ changed: number }>(
      call(manager, 'POST', '/console/submission-labels', change),
      200,
    );
    expect(result.changed).toBe(2);
    const touched = await changedSince('grants.application.labels_changed', before);
    expect([...touched].sort()).toEqual([...chosen()].sort());

    const again = await made<{ changed: number }>(
      call(manager, 'POST', '/console/submission-labels', change),
      200,
    );
    expect(again.changed, 'labels already there are left as they are').toBe(0);
  });

  test('a bulk change that names an unknown submission changes none', async () => {
    const before = await seen('grants.application.owner_changed');
    const answer = await call(manager, 'POST', '/console/submission-owners', {
      submissionIds: [untouched(), ABSENT_ID],
      ownerId,
    });
    expect(answer.status).toBe(404);
    expect(await changedSince('grants.application.owner_changed', before)).toEqual([]);
  });

  test('a saved view restores its filter when reopened, and Back returns to it', async ({
    pages,
  }) => {
    const name = `qzx withdrawn ${RUN}`;
    const view = await made<{ id: string }>(
      create(manager, '/console/saved-views', viewBody(name, 'withdrawn')),
    );
    const page = await pages.staff('manager');
    await page.goto('/northfield/');
    await openSubmissions(page);
    await expect(submissionRows(page).nth(1)).toBeVisible();

    const views = page.getByRole('combobox', { name: 'Saved views' });
    await views.selectOption({ label: name });
    await expect(submissionRows(page)).toHaveCount(1);

    await openOneAndReturn(page);
    await expect(views).toHaveValue(view.id);
    await expect(submissionRows(page)).toHaveCount(1);

    expect((await manager.send('DELETE', `/console/saved-views/${view.id}`)).status).toBe(204);
  });

  test('the second funder gets not found for every route that names the first funder records', async () => {
    const east = await signInStaff('eastmoor', 'eastManager');
    await stepUp(east, 'eastManager');
    const id = need('application1Id');
    const view = await made<{ id: string }>(
      create(manager, '/console/saved-views', viewBody(`qzx private ${RUN}`, null)),
    );
    const routes: [string, string, unknown?][] = [
      ['GET', `/console/submissions/${id}/notes`],
      ['POST', `/console/submissions/${id}/notes`, { body: 'qzx probe' }],
      ['GET', `/console/submissions/${id}/messages`],
      ['POST', `/console/submissions/${id}/messages`, { body: 'qzx probe' }],
      ['PUT', `/console/submissions/${id}/owner`, { ownerId: null }],
      ['PATCH', `/console/submissions/${id}/labels`, { add: [labelId] }],
      ['POST', '/console/submission-owners', { submissionIds: [id], ownerId: null }],
      ['GET', `/console/saved-views/${view.id}`],
      ['PUT', `/console/saved-views/${view.id}`, viewBody('qzx probe', null)],
      ['DELETE', `/console/saved-views/${view.id}`],
      ['POST', `/console/labels/${labelId}/archive`],
    ];
    for (const [method, path, json] of routes) {
      const answer = await call(east, method, path, json);
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(answer.text, `${method} ${path}`).not.toContain(id);
    }
    for (const name of ['tenantId', 'tenant_id', 'actorId', 'membershipId']) {
      const answer = await east.send('GET', `/console/saved-views/${view.id}`, {
        query: { [name]: need('programmeId') },
      });
      expect([400, 404], name).toContain(answer.status);
    }
    const listed = await east.ok<{ views: { id: string }[] }>('GET', '/console/saved-views');
    expect(listed.views.map(({ id: viewId }) => viewId)).not.toContain(view.id);
    expect((await manager.send('GET', `/console/saved-views/${view.id}`)).status).toBe(200);
    await manager.send('DELETE', `/console/saved-views/${view.id}`);
    await east.dispose();
  });
});
