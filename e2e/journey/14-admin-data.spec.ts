// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Demo step 14: the administrator saves the funder's publisher details,
// downloads the 360Giving file and the warehouse snapshot, loads the snapshot
// into a fresh PostgreSQL 16 with psql, and joins commitments to organisations
// and dates. Only released awards are in either, and both downloads are
// audited.

import {
  download360Giving,
  downloadSnapshot,
  openData,
  savePublisher,
  section,
} from '../../apps/console/e2e/data-steps.ts';
import { loadAndQuery } from '../../apps/console/e2e/data-psql.ts';
import { Api, signInStaff, stepUp } from '../support/api.ts';
import { addressFor, APPLICANT_PASSWORD, registerPerson } from '../support/applicants.ts';
import { auditEvents } from '../support/audit.ts';
import { axePages } from '../support/axe.ts';
import { groups } from '../support/applications.ts';
import { consoleOrigin } from '../support/env.ts';
import { tokenOf, waitForLink } from '../support/mail.ts';
import { need, person, readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

const count = async (request: Parameters<typeof auditEvents>[0], action: string) =>
  (await auditEvents(request, { action })).length;

/** The documented join: each commitment with its organisation, programme and day. */
const JOIN = `SELECT coalesce(json_agg(j ORDER BY j.amount_minor), '[]') FROM (
  SELECT c.amount_minor, c.currency, c.source_module, c.committed_on::text AS committed_on,
         o.name AS organisation, p.title AS programme, d.fiscal_year
    FROM commitment c
    JOIN organisation o ON o.id = c.organisation_id
    JOIN programme p ON p.id = c.programme_id
    JOIN date d ON d.date = c.committed_on) j`;

test.describe('step 14: the administrator takes the data out', () => {
  test('cannot choose a round for the 360Giving file with the administrator role alone, and the page says what to add', async ({
    pages,
  }) => {
    const page = await pages.staff('admin');
    const publisher = await count(page.request, 'grants.publisher_setting.changed');
    await page.goto('/northfield/');
    await openData(page);
    await savePublisher(page, {
      funderIdentifier: 'GB-CHC-7654321',
      funderName: 'Northfield Community Trust',
      identifierPrefix: '360G-northfield',
    });
    expect((await count(page.request, 'grants.publisher_setting.changed')) - publisher).toBe(1);
    await expect(page.getByText('You cannot choose a programme or round')).toBeVisible();
    await expect(page.getByText(/needs the programme manager role as well/)).toBeVisible();
    await expect(page.getByLabel('Awards to include')).toHaveCount(0);
    // The route itself needs only the export permission, so a round named by its id answers.
    const direct = await page.request.get(
      `/api/console/exports/360giving?roundId=${need('roundId')}`,
    );
    expect(direct.status()).toBe(200);
  });

  test('a second administrator joins by invitation and gives the first the programme manager role', async ({
    pages,
  }) => {
    const email = addressFor('colleague');
    registerPerson('colleague', email);
    const admin = await signInStaff('northfield', 'admin');
    await stepUp(admin, 'admin');
    await admin.ok('POST', '/console/team/invitations', {
      json: { email, roles: ['tenant_admin'] },
    });
    const team = await pages.staff('admin');
    await team.goto('/northfield/team');
    await expect(
      team.getByRole('table', { name: 'Invitations waiting to be accepted' }),
    ).toContainText(email);

    // They sign up at the console, set up their app, and accept from the emailed link.
    const joiner = await Api.open(consoleOrigin);
    await joiner.ok('POST', '/auth/tenants/northfield/sign-up', { json: { email } });
    await joiner.ok('POST', '/auth/sign-up/complete', {
      json: {
        token: tokenOf(await waitForLink(email, '/sign-up/complete')),
        password: APPLICANT_PASSWORD,
      },
    });
    await joiner.dispose();
    const colleague = await signInStaff('northfield', 'colleague');
    await colleague.ok('POST', '/auth/invitations/accept', {
      json: { token: tokenOf(await waitForLink(email, '/invitation')) },
    });

    // The colleague changes the first administrator's roles; nobody changes their own.
    const { members } = await colleague.ok<{ members: { id: string; email: string }[] }>(
      'GET',
      '/console/team',
    );
    const first = members.find((member) => member.email === person('admin').email);
    const own = await colleague.send(
      'PUT',
      `/console/team/members/${members.find((member) => member.email === email)?.id ?? ''}/roles`,
      {
        json: { roles: ['tenant_admin', 'programme_manager'] },
      },
    );
    expect(own.status).toBeGreaterThanOrEqual(400);
    await stepUp(colleague, 'colleague');
    await colleague.ok('PUT', `/console/team/members/${first?.id ?? ''}/roles`, {
      json: { roles: ['tenant_admin', 'programme_manager'] },
    });
    // A change to someone's roles ends their sessions, so they sign in again to use them.
    expect((await team.request.get('/api/console/team')).status()).toBe(401);
    expect(
      await auditEvents(colleague, { action: 'platform.membership.roles_changed' }),
    ).toHaveLength(1);
    expect(await auditEvents(colleague, { action: 'platform.invitation.sent' })).toHaveLength(1);
    expect(
      await auditEvents(colleague, { action: 'platform.auth.invitation_accepted' }),
    ).toHaveLength(1);
    await colleague.dispose();
    await admin.dispose();
  });

  test('downloads the 360Giving file of the round and the warehouse snapshot, both audited', async ({
    pages,
  }) => {
    const page = await pages.staff('admin');
    const exported = await count(page.request, 'grants.export.downloaded');
    const snapshots = await count(page.request, 'platform.warehouse.exported');

    await page.goto('/northfield/');
    await openData(page);
    const { file } = await download360Giving(page, 'Autumn 2026', 2);
    const awards = file.grants.map((grant) => Number(grant['amountAwarded']));
    expect(awards.sort((a, b) => a - b)).toEqual([7500, 12500]);
    expect(file.grants.every((grant) => grant['currency'] === 'GBP')).toBe(true);

    const script = await downloadSnapshot(page);
    expect(script).toContain('BEGIN;');
    expect(script).not.toContain('eastmoor');
    for (const { organisation } of groups)
      expect(script).not.toContain(`Withdrawn ${organisation}`);

    expect((await count(page.request, 'grants.export.downloaded')) - exported).toBe(1);
    expect((await count(page.request, 'platform.warehouse.exported')) - snapshots).toBe(1);

    // Loaded into a fresh PostgreSQL 16 with psql, the documented join gives the two awards.
    const joined = JSON.parse(await loadAndQuery(script, JOIN)) as {
      amount_minor: number;
      currency: string;
      source_module: string;
      committed_on: string;
      organisation: string;
      programme: string;
    }[];
    expect(joined.map(({ amount_minor: amount }) => amount)).toEqual([750_000, 1_250_000]);
    for (const row of joined) {
      expect(row).toMatchObject({
        currency: 'GBP',
        source_module: 'grants',
        programme: 'Community Spaces Fund',
      });
      expect(row.committed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const awarded = new Set(
      Object.entries(readState().ids)
        .filter(([key, value]) => key.startsWith('decision:') && value.startsWith('accepted:'))
        .map(([key]) => key),
    );
    expect(awarded.size).toBe(2);
    expect(need('roundId')).toBeTruthy();
    expect(new Set(joined.map(({ organisation }) => organisation)).size).toBe(2);
    expect(section(page, 'Warehouse snapshot')).toBeDefined();
  });

  test('@a11y the Data page has no axe violations', async ({ pages }) => {
    await axePages(await pages.staff('admin'), ['/northfield/data']);
  });
});
