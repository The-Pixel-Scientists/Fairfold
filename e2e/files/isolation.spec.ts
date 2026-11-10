// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first funder's file, asked for by the second funder's people. Each of
// the second funder's administrator, manager, reviewer and applicant gets
// "not found" for its download and its attachment list, with a problem that
// echoes no id; the first funder's applicant cannot be displaced by the
// second's attaching or removing it; and a tenant or an actor named in the
// request switches nothing (rules 2 and 6, ADR 0004).
//
// It reads what the journey left, so it runs after the journey and skips
// itself until the journey's state is there.

import { randomUUID } from 'node:crypto';

import { closeWorld, openWorld, type World } from '../isolation/world.ts';
import { accountsPdf } from '../fixtures/files.ts';
import { readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();
test.skip(
  readState().ids['accountsFileId'] === undefined,
  'The journey has not run: pnpm test:stack --project journey --workers 1 runs it first.',
);

let opened: World | undefined;

function world(): World {
  if (opened === undefined) throw new Error('The signed-in people are made in beforeAll.');
  return opened;
}

test.describe('the second funder cannot reach the first funder’s file', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    opened = await openWorld();
  });

  test.afterAll(async () => {
    await closeWorld(opened);
  });

  test('its staff and its applicant are told the file is not found, and the answer names nothing', async () => {
    const { b, fixture } = world();
    const { applicationId, fileId } = fixture;
    const staffRoutes = [
      `/console/submissions/${applicationId}/files/${fileId}`,
      `/console/submissions/${applicationId}/files`,
    ];
    // A reviewer may lack the permission and be refused before the record is looked up.
    const people = {
      admin: { api: b.admin, allowed: [404] },
      manager: { api: b.manager, allowed: [404] },
      reviewer: { api: b.reviewer, allowed: [403, 404] },
    };
    for (const [role, { api, allowed }] of Object.entries(people)) {
      for (const path of staffRoutes) {
        const answer = await api.send('GET', path);
        expect(allowed, `${role} ${path}`).toContain(answer.status);
        expect(answer.text, `${role} ${path}`).not.toContain(fileId);
        expect(answer.text, `${role} ${path}`).not.toContain(applicationId);
      }
    }
    for (const path of [
      `/portal/applications/${applicationId}/files/${fileId}`,
      `/portal/applications/${applicationId}/files`,
    ]) {
      const answer = await b.applicant.send('GET', path);
      expect(answer.status, path).toBe(404);
      expect(answer.text, path).not.toContain(fileId);
      expect(answer.text, path).not.toContain(applicationId);
    }
  });

  test('naming the first funder as the tenant or the actor does not change the answer', async () => {
    const { b, fixture } = world();
    const path = `/console/submissions/${fixture.applicationId}/files/${fixture.fileId}`;
    for (const name of ['tenantId', 'tenant_id', 'actorId', 'membershipId']) {
      const answer = await b.manager.send('GET', path, { query: { [name]: fixture.programmeId } });
      expect([400, 404, 422], name).toContain(answer.status);
      expect(answer.bytes.subarray(0, 5).toString(), name).not.toBe('%PDF-');
    }
  });

  test('its applicant can neither attach a file to, nor remove one from, the first funder’s application', async () => {
    const { a, b, fixture } = world();
    const list = async () =>
      (await a.applicant.send('GET', `/portal/applications/${fixture.applicationId}/files`)).text;
    const before = await list();

    const attached = await b.applicant.send(
      'POST',
      `/portal/applications/${fixture.applicationId}/fields/${fixture.fieldId}/files`,
      { file: { name: 'Eastmoor probe.pdf', bytes: accountsPdf() } },
    );
    expect(attached.status).toBe(404);
    const removed = await b.applicant.send(
      'DELETE',
      `/portal/applications/${fixture.applicationId}/files/${fixture.fileId}`,
    );
    expect(removed.status).toBe(404);

    expect(await list()).toBe(before);
    expect(before).toContain(fixture.fileId);
  });

  test('its own lists hold nothing of the first funder’s files', async () => {
    const { b, fixture } = world();
    const answers = [
      await b.applicant.send('GET', '/portal/applications'),
      await b.manager.send('GET', '/console/submissions', {
        query: { roundId: fixture.roundId },
      }),
      await b.manager.send('GET', `/console/submissions/${randomUUID()}/files`),
    ];
    for (const answer of answers) {
      expect(answer.text).not.toContain(fixture.fileId);
      expect(answer.text).not.toContain('accounts-2026');
    }
  });
});
