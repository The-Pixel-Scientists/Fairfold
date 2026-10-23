// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 1: the seed made Northfield Community Trust and a second tenant,
// each with an administrator, a programme manager and two reviewers. This
// step starts the journey's state with those people, checks the tenants are
// there and that the seed password gets no one past MFA, and every other step
// builds on it.

import { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin, seedPassword, staffEmails } from '../support/env.ts';
import { person, resetState, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const PEOPLE = [
  ['admin', 'northfield', 'tenant_admin', 0],
  ['manager', 'northfield', 'programme_manager', 0],
  ['reviewer1', 'northfield', 'reviewer', 0],
  ['reviewer2', 'northfield', 'reviewer', 1],
  ['eastAdmin', 'eastmoor', 'tenant_admin', 0],
  ['eastManager', 'eastmoor', 'programme_manager', 0],
  ['eastReviewer1', 'eastmoor', 'reviewer', 0],
  ['eastReviewer2', 'eastmoor', 'reviewer', 1],
] as const;

test.describe('step 1: the seed made two tenants and their staff', () => {
  test('lists both funders and their staff, none past MFA yet', async ({ pages }) => {
    resetState();
    updateState((state) => {
      for (const [name, slug, role, index] of PEOPLE) {
        const email = staffEmails(slug, role)[index];
        if (email === undefined) throw new Error(`The base scenario has no ${name}.`);
        state.people[name] = { email, password: seedPassword() };
      }
    });

    const api = await Api.open(consoleOrigin);
    for (const [slug, name] of [
      ['northfield', 'Northfield Community Trust'],
      ['eastmoor', 'Eastmoor Foundation'],
    ]) {
      const tenant = await api.send('GET', `/public/tenants/${slug ?? ''}`);
      expect(tenant.status, slug).toBe(200);
      expect(tenant.text, slug).toContain(name);
    }
    expect((await api.send('GET', '/public/tenants/no-such-funder')).status).toBe(404);
    expect((await api.send('GET', '/console/programmes')).status).toBe(401);
    await api.dispose();

    for (const [name, slug] of PEOPLE) {
      const { email, password } = person(name);
      const staff = await Api.open(consoleOrigin);
      const session = await staff.send('POST', `/auth/tenants/${slug}/sign-in`, {
        json: { email, password },
      });
      expect(
        session.status,
        `${name} cannot sign in with the seed password. The journey needs a fresh stack: pnpm stack down --volumes, pnpm stack, pnpm stack seed base.`,
      ).toBe(200);
      expect((session.json as { mfa: string }).mfa, name).toMatch(/^(enrol|verify)$/);
      expect((await staff.send('GET', '/console/programmes')).status, name).toBe(401);
      await staff.dispose();
    }

    const visitor = await pages.visitor();
    await visitor.goto('/northfield/sign-in');
    await expect(h1(visitor, 'Sign in')).toBeVisible();
  });

  test('@a11y the sign-in pages of both apps have no axe violations', async ({ pages }) => {
    await axePages(await pages.visitor(), ['/northfield/sign-in', '/eastmoor/sign-in']);
    await axePages(await pages.visitor('console'), ['/northfield/sign-in']);
  });
});
