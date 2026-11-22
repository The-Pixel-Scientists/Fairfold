// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Emergency access, as far as the stack can show it today. No module has
// registered a restrictable record type, so no record can be restricted and no
// grant can be opened, and no role holds the permission to open one yet; the
// journeys that need one (the dialog, the one-hour grant, ending it, blind
// review under a grant) wait for the first module that registers a type and
// the role that holds the permission. What holds now: every way of asking for
// a grant is refused and creates none, the second funder is told nothing
// about the first funder's records, and the Emergency access page tells a
// member who may not open records so, and passes axe.
//
// It reads what the journey left, so it runs after the journey.

import { signInStaff, stepUp } from '../../support/api.ts';
import { auditEvents } from '../../support/audit.ts';
import { axePages } from '../../support/axe.ts';
import { need } from '../../support/state.ts';
import { expect, h1, inOrder, test } from '../../support/test.ts';
import { auditReader, call, create, needsJourney } from '../../triage/steps.ts';

inOrder();
needsJourney();

const REASON = 'Synthetic: a safeguarding concern needs the record tonight.';

test.describe('emergency access', () => {
  test('every request for a grant is refused and creates none, and nothing is audited as opened', async () => {
    const admin = await signInStaff('northfield', 'colleague');
    await stepUp(admin, 'colleague');
    const reader = await auditReader();
    const before = (await auditEvents(reader, { action: 'platform.break_glass.opened' })).length;

    const record = need('application1Id');
    const bodies: unknown[] = [
      {},
      { recordType: 'grants.application', recordId: record },
      { recordType: 'grants.application', recordId: record, reasonCode: 'other' },
      { recordType: 'grants.application', recordId: record, reasonText: REASON },
      {
        recordType: 'grants.application',
        recordId: record,
        reasonCode: 'other',
        reasonText: REASON,
        expiresAt: '2099-01-01T00:00:00Z',
      },
      {
        recordType: 'grants.application',
        recordId: record,
        reasonCode: 'other',
        reasonText: REASON,
        tenantId: record,
      },
    ];
    bodies.push({
      recordType: 'grants.application',
      recordId: record,
      reasonCode: 'other',
      reasonText: REASON,
    });
    for (const body of bodies) {
      const answer = await create(admin, '/console/break-glass', body);
      expect([400, 403], JSON.stringify(body)).toContain(answer.status);
      expect(answer.text).not.toContain(record);
    }
    expect(await auditEvents(reader, { action: 'platform.break_glass.opened' })).toHaveLength(
      before,
    );
    await Promise.all([admin.dispose(), reader.dispose()]);
  });

  test('the second funder is refused and told nothing about the first funder’s record', async () => {
    const east = await signInStaff('eastmoor', 'eastAdmin');
    await stepUp(east, 'eastAdmin');
    const record = need('application1Id');
    const answer = await create(east, '/console/break-glass', {
      recordType: 'grants.application',
      recordId: record,
      reasonCode: 'other',
      reasonText: REASON,
    });
    expect([400, 403, 404]).toContain(answer.status);
    expect(answer.text).not.toContain(record);
    expect((await call(east, 'GET', '/console/break-glass')).status).toBe(403);
    await east.dispose();
  });

  test('no seeded role may open emergency access: every call is refused', async () => {
    const reviewer = await signInStaff('northfield', 'reviewer1');
    expect((await call(reviewer, 'GET', '/console/break-glass')).status).toBe(403);
    const answer = await create(reviewer, '/console/break-glass', {
      recordType: 'grants.application',
      recordId: need('application1Id'),
      reasonCode: 'other',
      reasonText: REASON,
    });
    expect(answer.status).toBe(403);
    await reviewer.dispose();
  });

  test('the page tells a member without the permission so, and passes axe', async ({ pages }) => {
    const page = await pages.staff('colleague');
    await page.goto('/northfield/emergency-access');
    await expect(h1(page, 'Emergency access')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot open records in an emergency' }),
    ).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await axePages(page, ['/northfield/emergency-access']);
  });
});
