// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BreakGlassDialog } from './BreakGlassDialog.tsx';
import type { BreakGlassDialogProps } from './BreakGlassDialog.tsx';
import { RecordAccessPanel } from './RecordAccessPanel.tsx';
import { formatUkTime } from './time.ts';

afterEach(cleanup);

describe('formatUkTime', () => {
  it('shows UK time, in summer and in winter', () => {
    expect(formatUkTime('2027-01-20T15:20:00.000Z')).toBe('20 January 2027, 3:20pm');
    expect(formatUkTime('2027-07-20T15:20:00.000Z')).toBe('20 July 2027, 4:20pm');
  });
});

describe('RecordAccessPanel', () => {
  it('lists each member by name with a plain reason, and an emergency expiry in UK time', () => {
    render(
      <RecordAccessPanel
        access={{
          entries: [
            { membershipId: 'a', name: 'Asha Patel', reason: 'role' },
            { membershipId: 'b', name: 'Ben Okoye', reason: 'team', teamName: 'Casework' },
            { membershipId: 'c', name: null, reason: 'assigned' },
            {
              membershipId: 'd',
              name: 'Dee Lowe',
              reason: 'break_glass',
              expiresAt: '2027-01-20T15:20:00.000Z',
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Who can reach this record' })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[0] as HTMLElement).getByText('Asha Patel')).toBeTruthy();
    expect(screen.getByText('Through the Casework team')).toBeTruthy();
    expect(screen.getByText('Not named yet')).toBeTruthy();
    expect(screen.getByText('Assigned to them')).toBeTruthy();
    expect(screen.getByText('Emergency access until 20 January 2027, 3:20pm UK time')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it('says what to do when no one can reach the record', () => {
    render(<RecordAccessPanel access={{ entries: [] }} />);
    expect(screen.getByRole('heading', { name: 'No one can reach this record' })).toBeTruthy();
    expect(screen.getByText(/Assign it to a member or a team/)).toBeTruthy();
  });
});

function setUp(onOpen: BreakGlassDialogProps['onOpen']) {
  const onContinue = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <BreakGlassDialog open onOpenChange={onOpenChange} onOpen={onOpen} onContinue={onContinue} />,
  );
  return { onContinue, onOpenChange };
}

const submit = () =>
  userEvent.click(screen.getByRole('button', { name: 'Open record in an emergency' }));

describe('BreakGlassDialog', () => {
  it('warns plainly, and moves focus into the dialog', async () => {
    setUp(vi.fn());
    const dialog = await screen.findByRole('dialog', { name: 'Open this record in an emergency' });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(
      screen.getByText(
        'You are opening a restricted record. Your name, the time and your reason are recorded and an administrator is alerted.',
      ),
    ).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const reasons = within(screen.getByRole('combobox', { name: 'Reason' })).getAllByRole('option');
    expect(reasons.map((option) => option.textContent)).toEqual([
      'Choose a reason',
      'Risk to life',
      'Safeguarding concern',
      'Legal duty',
      'The people named on the record are not available',
      'Another emergency',
    ]);
  });

  it('cannot be sent without both reasons', async () => {
    const onOpen = vi.fn();
    setUp(onOpen);
    await submit();
    expect(
      await screen.findByRole('link', { name: 'Choose a reason from the list.' }),
    ).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'legal_duty');
    await userEvent.type(screen.getByRole('textbox', { name: /Explain why/ }), 'Too short');
    await submit();
    expect(
      (await screen.findAllByText(/Explain why you need access in 20 to 1,000 characters/)).length,
    ).toBeGreaterThan(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('sends the reasons and nothing else, then shows only the expiry the server gave', async () => {
    const onOpen = vi.fn(() => Promise.resolve({ expiresAt: '2027-01-20T15:20:00.000Z' }));
    const { onContinue } = setUp(onOpen);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'risk_to_life');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Explain why/ }),
      'A child may be at immediate risk.',
    );
    await submit();

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith({
        reasonCode: 'risk_to_life',
        reasonText: 'A child may be at immediate risk.',
      });
    });
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'You can read this record until 20 January 2027, 3:20pm UK time. After that, you need to open it again with a new reason.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue to the record' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('stays as it was, with what was typed, when step-up is cancelled', async () => {
    setUp(vi.fn(() => Promise.resolve(null)));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'other');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Explain why/ }),
      'The named people cannot be reached.',
    );
    await submit();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open record in an emergency' })).toBeTruthy();
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Explain why/ }).value).toBe(
      'The named people cannot be reached.',
    );
  });

  it('shows the words of a refusal in the summary, and keeps the dialog open', async () => {
    const detail = 'You cannot open this record. Ask an administrator for access.';
    setUp(vi.fn(() => Promise.reject(new ProblemError(403, detail))));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'other');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Explain why/ }),
      'The named people cannot be reached.',
    );
    await submit();
    expect(await screen.findByRole('link', { name: detail })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Cancel', async () => {
    const { onOpenChange } = setUp(vi.fn());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('steps aside while paused', () => {
    render(
      <BreakGlassDialog open paused onOpenChange={vi.fn()} onOpen={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
