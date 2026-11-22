// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BreakGlassGrant } from '@pixel-scientists/domain/platform/team';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, heading, ok } from '../settings/testing.ts';
import { GrantsTable } from './GrantsTable.tsx';

setUpConsoleTests();

const LIST = 'GET /console/break-glass';

function member() {
  const session = consoleSession({ roles: ['tenant_admin'] });
  return { ...session, permissions: [...session.permissions, 'platform.break_glass.use'] };
}

/** No restrictable record type is registered yet, so no response could carry one. */
const grant = {
  id: '8e4f5061-7283-4d94-8ea5-c6d7e8f90a1b',
  recordType: 'cases.case',
  recordId: '9f506172-8394-4ea5-9fb6-d7e8f90a1b2c',
  reasonCode: 'risk_to_life',
  grantedAt: '2027-01-20T14:20:00.000Z',
  expiresAt: '2027-01-20T15:20:00.000Z',
} as unknown as BreakGlassGrant;

describe('the emergency access page', () => {
  it('says what to do when nothing is open', async () => {
    stubApi({ [SESSION]: ok(member()), [LIST]: ok({ grants: [] }) });
    openConsole('/northfield/emergency-access');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No emergency access is open' }),
    ).toBeTruthy();
    expect(screen.getByText(/an administrator is alerted/)).toBeTruthy();
    await heading('Emergency access');
    await expectTitle('Emergency access – Fairfold Grants console');
  });

  it('shows why the list did not load', async () => {
    stubApi({
      [SESSION]: ok(member()),
      [LIST]: problem(500, 'Your emergency access could not be read.'),
    });
    openConsole('/northfield/emergency-access');
    expect(await screen.findByText('Your emergency access could not be read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('tells someone without the permission, and asks the API for nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['tenant_admin'] })) });
    openConsole('/northfield/emergency-access');
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'You cannot open records in an emergency',
      }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });
});

describe('the open grants table', () => {
  it('lists each with its expiry in UK time, no id and no way to renew one', () => {
    render(<GrantsTable grants={[grant]} />);

    const row = within(screen.getByRole('row', { name: /Risk to life/ }));
    expect(row.getByText('Case')).toBeTruthy();
    expect(row.getByText('20 January 2027, 2:20pm')).toBeTruthy();
    expect(row.getByText('20 January 2027, 3:20pm UK time')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.body.textContent).not.toContain(grant.recordId);
  });
});
