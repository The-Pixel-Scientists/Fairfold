// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 2: the administrator gets a password of their own by the reset
// path (the seeded account has the seed password), enrols an authenticator app
// from the key on the screen, and signs in to the console at /northfield. The
// code comes from the key with a small helper, as an app would work it out,
// and a code works once. Decided: the reset path, because the seed already
// made the account; email-first sign-up is the applicants' way in (step 7) and
// the invited colleague's (team journey).

import { totp } from '../../apps/console/e2e/auth-totp.ts';
import { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin } from '../support/env.ts';
import { openEmailedLink } from '../support/mail.ts';
import { person, updateState } from '../support/state.ts';
import { expect, h1, inOrder, test } from '../support/test.ts';

inOrder();

const PASSWORD = 'northfield administrator passphrase';

test.describe('step 2: the administrator signs in with a code from their app', () => {
  test('resets the seed password by email, enrols an authenticator app and reaches the console', async ({
    pages,
  }) => {
    const { email } = person('admin');
    const visitor = await pages.visitor('console');
    await visitor.goto('/northfield/forgot-password');
    await visitor.getByRole('textbox', { name: 'Email address' }).fill(email);
    await visitor.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(h1(visitor, 'Check your email')).toBeVisible();

    await openEmailedLink(visitor, email, '/reset-password');
    await expect(visitor).toHaveURL(/\/northfield\/reset-password$/);
    await visitor.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await visitor.getByRole('button', { name: 'Save new password' }).click();
    await expect(
      visitor.getByText('Your password has changed. Sign in with your new password.'),
    ).toBeVisible();
    updateState((state) => {
      const admin = state.people['admin'];
      if (admin !== undefined) admin.password = PASSWORD;
    });

    // The first sign-in shows the key; the page types the code worked out from it.
    const page = await pages.staff('admin', 'northfield', true);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const link of ['Settings', 'Team', 'Data', 'Audit log']) {
      await expect(nav.getByRole('link', { name: link })).toBeVisible();
    }
    expect(person('admin').key).toMatch(/^[A-Z2-7]{16,}$/);
  });

  test('signs in again with a fresh code, and a code that was used is refused', async ({
    pages,
  }) => {
    const again = await pages.staff('admin', 'northfield', true);
    await expect(again.getByRole('navigation', { name: 'Main' })).toBeVisible();

    const { email, password, key, lastStep } = person('admin');
    const api = await Api.open(consoleOrigin);
    await api.ok('POST', '/auth/tenants/northfield/sign-in', { json: { email, password } });
    const spent = totp(key ?? '', (lastStep ?? 0) * 30_000);
    const refused = await api.send('POST', '/auth/totp/verify', { json: { code: spent } });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect((await api.send('GET', '/console/team')).status).toBe(401);
    await api.dispose();
  });

  test('@a11y the console pages the administrator visits have no axe violations', async ({
    pages,
  }) => {
    await axePages(await pages.staff('admin'), [
      '/northfield/settings',
      '/northfield/team',
      '/northfield/data',
      '/northfield/audit-log',
    ]);
  });
});
