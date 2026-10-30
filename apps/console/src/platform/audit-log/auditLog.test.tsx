// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok } from '../settings/testing.ts';

setUpConsoleTests();

const EVENTS = 'GET /console/audit-events';
const SETTINGS = 'GET /console/settings';
const TEAM = 'GET /console/team';
const ADA = '5b1a8d3e-2c4f-4e7a-9b6d-1a2b3c4d5e6f';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The nth event, newest first: 1 is 2:04pm on 14 October 2026, London time. */
const event = (n: number, changes: Record<string, unknown> = {}) => ({
  id: uuid(n),
  occurredAt: new Date(Date.UTC(2026, 9, 14, 13, 5) - n * 60_000).toISOString(),
  action: 'grants.application.stage_changed',
  entityType: 'grants.application',
  entityId: uuid(5000 + n),
  actor: { kind: 'staff', membershipId: ADA, name: 'Ada Morgan' },
  changes,
});

const page = (events: unknown[], nextCursor: string | null = null) => ok({ events, nextCursor });

const settings = ok({
  name: 'Northfield Foundation',
  timeZone: 'Europe/London',
  fiscalYearStartMonth: 4,
});

const team = ok({
  members: [
    {
      id: ADA,
      name: 'Ada Morgan',
      email: 'ada@example.org',
      roles: ['tenant_admin'],
      status: 'active',
    },
  ],
  invitations: [],
});

async function openLog(
  handlers: Record<string, Reply | (() => Reply)> = { [EVENTS]: page([event(1), event(2)]) },
  path = '/northfield/audit-log',
) {
  const sent = stubApi({
    [SESSION]: ok(administrator()),
    [SETTINGS]: settings,
    [TEAM]: team,
    ...handlers,
  });
  openConsole(path);
  await heading('Audit log');
  return sent;
}

const rows = () => screen.getAllByRole('row').slice(1);
const rowAt = (index: number) => within(rows()[index] as HTMLElement);

describe('the audit log', () => {
  it('lists events newest first, in words, with the time in the funder time zone', async () => {
    await openLog();

    await screen.findByRole('table', { name: 'Events in the audit log, newest first' });
    expect(rows()).toHaveLength(2);
    expect(rowAt(0).getByRole('rowheader').textContent).toBe('14 October 2026, 2:04pm');
    expect(rowAt(0).getByText('Application stage changed')).toBeTruthy();
    expect(rowAt(0).getByText('Application')).toBeTruthy();
    expect(rowAt(0).getByText('Grants')).toBeTruthy();
    expect(rowAt(0).getByText('Ada Morgan')).toBeTruthy();
    expect(screen.getByText('Showing all 2 events, newest first.')).toBeTruthy();
    await expectTitle('Audit log – Fairfold Grants console');
  });

  it('is in the navigation for an administrator', async () => {
    await openLog();

    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'Audit log',
    });
    expect(link.getAttribute('href')).toBe('/northfield/audit-log');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('shows what changed, with values where they were kept and "Changed" where they were not', async () => {
    const user = userEvent.setup();
    await openLog({
      [EVENTS]: page([
        event(1, {
          'grants.round.status': { before: 'draft', after: 'open' },
          'grants.round.closes_at': { after: '2026-12-01' },
          'grants.round.notes': {},
        }),
      ]),
    });
    await user.click(
      await screen.findByRole('button', { name: /^View details of application stage changed/ }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Application stage changed' });
    expect(dialog.textContent).toContain('14 October 2026, 2:04pm');
    expect(dialog.textContent).toContain(uuid(5001));
    const items = within(within(dialog).getByRole('list', { name: 'Changed fields' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Status');
    expect(items[0]?.textContent).toContain('grants.round.status');
    expect(items[0]?.textContent).toContain('Beforedraft');
    expect(items[0]?.textContent).toContain('Afteropen');
    expect(items[1]?.textContent).toContain('BeforeNot recorded');
    expect(items[1]?.textContent).toContain('After2026-12-01');
    expect(items[2]?.textContent).toContain('Changed');
    expect(items[2]?.textContent).not.toContain('Before');
  });

  it('says so when an event changed no fields', async () => {
    const user = userEvent.setup();
    await openLog({ [EVENTS]: page([event(1)]) });

    await user.click(await screen.findByRole('button', { name: /^View details/ }));

    expect((await screen.findByRole('dialog')).textContent).toContain(
      'This event did not change any fields.',
    );
  });

  it('names staff only, and never an applicant', async () => {
    const user = userEvent.setup();
    await openLog({
      [EVENTS]: page([
        { ...event(1), actor: { kind: 'applicant', membershipId: uuid(9) } },
        { ...event(2), actor: { kind: 'system' } },
        { ...event(3), actor: { kind: 'staff', membershipId: ADA, name: null } },
      ]),
    });
    await screen.findByRole('table');

    expect(rowAt(0).getByText('Applicant')).toBeTruthy();
    expect(rowAt(1).getByText('System')).toBeTruthy();
    expect(rowAt(2).getByText('Team member')).toBeTruthy();
    await user.click(rowAt(0).getByRole('button'));
    expect((await screen.findByRole('dialog')).textContent).not.toContain(uuid(9));
  });

  it('opens an event with Enter and gives focus back to its row, and lists the keys with a question mark', async () => {
    const user = userEvent.setup();
    await openLog();
    await screen.findByRole('table');

    rows()[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Application stage changed' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(rows()[1]);
    });

    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('reads the filters from the address and sends them as the contract takes them', async () => {
    const query = `?module=grants&entityId=${uuid(7)}&from=2026-10-01&to=2026-10-31`;
    const sent = await openLog(
      { [`${EVENTS}${query}`]: page([event(1)]) },
      `/northfield/audit-log${query}`,
    );

    await screen.findByRole('table');
    expect(sent.map(({ key }) => key)).toContain(`${EVENTS}${query}`);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Module' }).value).toBe(
      'grants',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Entity ID' }).value).toBe(
      uuid(7),
    );
    expect(screen.getByLabelText<HTMLInputElement>('From').value).toBe('2026-10-01');
    expect(screen.getByLabelText<HTMLInputElement>('To').value).toBe('2026-10-31');
  });

  it('applies the filters only when asked, and puts them in the address', async () => {
    const user = userEvent.setup();
    await openLog({
      [EVENTS]: page([event(1)]),
      [`${EVENTS}?module=grants&byMembershipId=${ADA}`]: page([event(2)]),
    });
    await screen.findByRole('table');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'Grants');
    const person = screen.getByRole('combobox', { name: 'Person' });
    await within(person).findByRole('option', { name: 'Ada Morgan' });
    await user.selectOptions(person, 'Ada Morgan');
    expect(window.location.search).toBe('');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(window.location.search).toBe(`?module=grants&byMembershipId=${ADA}`);
    });
    await waitFor(() => {
      expect(rowAt(0).getByRole('rowheader').textContent).toBe('14 October 2026, 2:03pm');
    });
  });

  it('narrows the actions to the module, and clears them when the module changes', async () => {
    const user = userEvent.setup();
    await openLog(
      { [`${EVENTS}?action=platform.theme.changed`]: page([event(1)]) },
      '/northfield/audit-log?action=platform.theme.changed',
    );
    await screen.findByRole('table');
    const action = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Action' });
    expect(action.value).toBe('platform.theme.changed');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'Grants');

    expect(action.value).toBe('');
    const names = within(action)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(names).toContain('Application submitted');
    expect(names).not.toContain('Theme changed');
  });

  it('says what is wrong with a filter next to it, and applies nothing', async () => {
    const user = userEvent.setup();
    await openLog();
    await screen.findByRole('table');

    await user.type(screen.getByRole('textbox', { name: 'Entity ID' }), 'abc');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    const field = screen.getByRole('textbox', { name: 'Entity ID' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(screen.getByText(/Enter the whole ID/)).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('loads more events below the first ones, and moves focus to the first new row', async () => {
    const user = userEvent.setup();
    await openLog({
      [EVENTS]: page([event(1), event(2), event(3)], 'abc_123'),
      [`${EVENTS}?cursor=abc_123`]: page([event(4), event(5)]),
    });
    await screen.findByRole('table');
    expect(
      screen.getByText('Showing the newest 3 events. Load more to see older ones.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more events' }));

    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(rows()[3]);
    });
    expect(screen.getByText('Showing all 5 events, newest first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load more events/ })).toBeNull();
  });

  it('says what went wrong when more events cannot be loaded, and keeps the ones shown', async () => {
    const user = userEvent.setup();
    await openLog({
      [EVENTS]: page([event(1), event(2)], 'abc_123'),
      [`${EVENTS}?cursor=abc_123`]: problem(503, 'The service is busy. Try again in a minute.'),
    });
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Load more events' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The service is busy. Try again in a minute.',
    );
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Load more events' })).toBeTruthy();
  });

  it('tells a person with no matching events which filters to change', async () => {
    const user = userEvent.setup();
    await openLog(
      {
        [`${EVENTS}?module=party`]: page([]),
        [EVENTS]: page([event(1)]),
      },
      '/northfield/audit-log?module=party',
    );

    expect(await screen.findByText('No events match these filters')).toBeTruthy();
    expect(screen.getByText(/Widen the dates, or remove a filter/)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[1] as HTMLElement);
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('says what happens next when the log is empty', async () => {
    await openLog({ [EVENTS]: page([]) });

    expect(await screen.findByText('No events yet')).toBeTruthy();
    expect(screen.getByText(/Events appear here as people use this account/)).toBeTruthy();
  });

  it('says what went wrong, and offers to try again, when the log cannot be read', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      [SESSION]: ok(administrator()),
      [SETTINGS]: settings,
      [TEAM]: team,
      [EVENTS]: () => {
        reads += 1;
        return reads === 1 ? problem(500, messages.serviceFailed) : page([event(1)]);
      },
    });
    openConsole('/northfield/audit-log');

    expect(await screen.findByText('We could not load the audit log')).toBeTruthy();
    expect(screen.getByText(messages.serviceFailed)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows times in the browser zone, and cannot choose a person, when settings and the team cannot be read', async () => {
    await openLog({
      [SETTINGS]: problem(403, 'You cannot change settings.'),
      [TEAM]: problem(403, 'You cannot manage the team.'),
      [EVENTS]: page([event(1)]),
    });

    await screen.findByRole('table');
    expect(rows()[0]?.textContent).toMatch(/14 October 2026, \d{1,2}:04(am|pm)/);
    const person = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Person' });
    await waitFor(() => {
      expect(within(person).getByRole('option').textContent).toBe('The team did not load');
    });
    expect(person.disabled).toBe(true);
  });

  it('refuses an address with a filter that does not exist, and offers the whole log', async () => {
    await openLog({}, '/northfield/audit-log?module=bogus');

    expect(await screen.findByText('These filters are not valid')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Show the whole log' }).getAttribute('href')).toBe(
      '/northfield/audit-log',
    );
  });

  it('is not for a programme manager: it says who to ask, and reads nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/audit-log');

    expect(await heading('Audit log')).toBeTruthy();
    expect(screen.getByText('You cannot read the audit log')).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
        name: 'Audit log',
      }),
    ).toBeNull();
  });
});
