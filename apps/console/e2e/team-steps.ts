// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The team screens as a person uses them: an administrator invites someone,
// confirming it is them when asked, and later suspends them. The stubbed spec
// (team.spec.ts) and the journey against the real API (team-journey.spec.ts)
// both take these steps, so the screens are checked the same way against each.

import { expect } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export const membersTable = (page: Page) =>
  page.getByRole('table', { name: 'Members of Northfield Foundation' });

export const invitationsTable = (page: Page) =>
  page.getByRole('table', { name: 'Invitations waiting to be accepted' });

export const memberRow = (page: Page, text: string | RegExp) =>
  membersTable(page).getByRole('row', { name: text });

export const status = (page: Page) => page.getByRole('status').filter({ hasText: /\S/ });

/** Opens the team from the navigation. */
export async function openTeam(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }).click();
  await expect(h1(page, 'Team')).toBeFocused();
  await expect(membersTable(page)).toBeVisible();
}

/** Answers the step-up dialog with the password and a code. */
export async function confirmItsYou(page: Page, password: string, code: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill(password);
  await dialog.getByLabel('Code from your authenticator app').fill(code);
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(dialog).toBeHidden();
}

/** Fills in the invitation, ticking the role by its id, and sends it. The caller answers the step-up dialog if it opens. */
export async function sendInvitation(page: Page, email: string, role: string): Promise<void> {
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite someone' });
  await dialog.getByLabel('Email address').fill(email);
  await dialog.locator(`input[type="checkbox"][value="${role}"]`).check();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
}

/** Suspends a member after reading what the confirmation says. The caller answers the step-up dialog if it opens. */
export async function suspendMember(page: Page, name: string): Promise<void> {
  await memberRow(page, name)
    .getByRole('button', { name: `Suspend for ${name}` })
    .click();
  const dialog = page.getByRole('dialog', { name: `Suspend ${name}?` });
  await expect(dialog).toContainText('They will be signed out of Northfield Foundation now');
  await dialog.getByRole('button', { name: `Suspend ${name}` }).click();
}
