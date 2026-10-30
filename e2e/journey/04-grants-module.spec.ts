// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 4: the administrator checks that Grants is switched on for the
// funder. The switch is per funder: with Grants off the programme manager is
// told nothing exists, and with it on again the manager has their pages back.
// Each switch is in the audit log.

import { signInStaff } from '../support/api.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

test.describe('step 4: Grants is on for the funder', () => {
  test('shows Grants on, and switching it off hides it from the manager until it is on again', async ({
    pages,
  }) => {
    const page = await pages.staff('admin');
    await page.goto('/northfield/settings/modules');
    await expect(h1(page, 'Modules')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeVisible();

    const actions = ['platform.module.switched_off', 'platform.module.switched_on'];
    const before: Record<string, number> = {};
    for (const action of actions) {
      before[action] = (await auditEvents(page.request, { action })).length;
    }

    const manager = await signInStaff('northfield', 'manager');
    expect((await manager.send('GET', '/console/programmes')).status).toBe(200);

    await page.getByRole('button', { name: 'Switch off Grants' }).click();
    await page
      .getByRole('dialog', { name: 'Switch off Grants?' })
      .getByRole('button', { name: 'Switch off Grants' })
      .click();
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is off' })).toBeVisible();
    expect((await manager.send('GET', '/console/programmes')).status).toBe(404);

    // The other funder keeps Grants.
    const east = await signInStaff('eastmoor', 'eastManager');
    expect((await east.send('GET', '/console/programmes')).status).toBe(200);
    await east.dispose();

    await page.getByRole('button', { name: 'Switch on Grants' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Grants is on' })).toBeVisible();
    expect((await manager.send('GET', '/console/programmes')).status).toBe(200);
    await manager.dispose();

    for (const action of actions) {
      const events = await auditEvents(page.request, { action });
      expect(events.length - (before[action] ?? 0), action).toBe(1);
    }
  });

  test('@a11y the Modules page has no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('admin'), ['/northfield/settings/modules']);
  });
});
