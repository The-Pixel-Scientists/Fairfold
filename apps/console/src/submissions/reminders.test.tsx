// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import {
  api,
  detail,
  heading,
  manager,
  ok,
  page,
  programmes,
  stages,
  summary,
} from './fixtures.ts';

setUpConsoleTests();

const one = detail();
const HISTORY = `GET /console/submissions/${one.id}/reminders`;

const reads = (history: unknown) => ({
  ...manager(),
  [api.programmes]: ok(programmes),
  [api.stages]: ok({ stages }),
  [api.one(one.id)]: ok(one),
  [api.files(one.id)]: ok({ attachments: [] }),
  [api.assignments(one.id)]: ok({ assignments: [] }),
  [api.list()]: ok(page([summary(1)])),
  [HISTORY]: ok(history),
});

describe('reminder history on a submission', () => {
  it('reads nothing until the section is opened, then lists each reminder in words and UK time', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads({
        reminders: [
          { kind: 'draft_closing', at: '2027-03-28T16:00:00.000Z', outcome: 'sent', reason: null },
          {
            kind: 'review_overdue',
            at: '2026-10-25T12:30:00.000Z',
            outcome: 'skipped',
            reason: 'not_needed',
          },
        ],
      }),
    );
    openConsole(`/northfield/submissions/${one.id}`);
    await heading('Harbourside Youth Project');
    const panel = await screen.findByRole('region', { name: 'Reminders' });
    expect(within(panel).getByText(/never change an application or a review/)).toBeTruthy();
    expect(sent.some(({ key }) => key === HISTORY)).toBe(false);

    await user.click(within(panel).getByRole('button', { name: 'Show reminders' }));

    const items = await within(panel).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Application closing soon28 March 2027 at 5pm. Sent.',
      'Review overdue25 October 2026 at 12:30pm. Not sent: the application was submitted or the review was finished.',
    ]);
    expect(within(panel).getByRole('button', { name: 'Hide reminders' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /send|resend|close/i })).toBeNull();
  });

  it('says plainly when none have been due', async () => {
    const user = userEvent.setup();
    stubApi(reads({ reminders: [] }));
    openConsole(`/northfield/submissions/${one.id}`);
    await heading('Harbourside Youth Project');

    await user.click(await screen.findByRole('button', { name: 'Show reminders' }));

    expect(await screen.findByText('No reminders have been due yet.')).toBeTruthy();
  });
});
