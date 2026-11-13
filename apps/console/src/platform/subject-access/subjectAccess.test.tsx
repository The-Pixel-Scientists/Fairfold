// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem } from '../../testing/api.ts';
import { expectTitle, setUpConsoleTests } from '../../testing/render.tsx';
import { administrator, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from '../team/change.ts';
import {
  FILE,
  PARTY,
  READ_EXPORT,
  REQUEST,
  REQUEST_EXPORT,
  SEARCH,
  STEP_UP,
  confirmItIsYou,
  expectNothingKept,
  open,
} from './testing.ts';

setUpConsoleTests();

const requested = { id: REQUEST, requestedAt: '2026-11-10T09:00:00.000Z' };

describe('finding a person', () => {
  it('searches with the term in the body only and links each result to its page', async () => {
    const user = userEvent.setup();
    const sent = open('/settings/subject-access', {
      [SEARCH]: ok({
        results: [
          {
            id: PARTY,
            kind: 'person',
            label: 'Amara Okafor',
            status: 'active',
            verification: 'none',
          },
        ],
        nextCursor: null,
      }),
    });
    await heading('Subject access and erasure');

    await user.type(screen.getByLabelText('Name or email address'), 'amara');
    await user.click(screen.getByRole('button', { name: 'Find person' }));

    const link = await screen.findByRole('link', { name: 'Choose Amara Okafor' });
    expect(link.getAttribute('href')).toBe(`/northfield/settings/subject-access/people/${PARTY}`);
    expect(sent.find(({ key }) => key === SEARCH)?.body).toEqual({
      term: 'amara',
      kinds: ['person'],
      limit: 25,
    });
    expect(window.location.href).not.toMatch(/amara/);
    expect(window.location.search).toBe('');
    expectNothingKept();
  });

  it('keeps one status line mounted from the start, so a result is announced', async () => {
    const user = userEvent.setup();
    open('/settings/subject-access', { [SEARCH]: ok({ results: [], nextCursor: null }) });
    await heading('Subject access and erasure');
    const live = within(screen.getByRole('main')).getByRole('status');
    expect(live.textContent).toBe('');

    await user.type(screen.getByLabelText('Name or email address'), 'nobody');
    await user.click(screen.getByRole('button', { name: 'Find person' }));

    await waitFor(() => {
      expect(live.textContent).toBe('No people found.');
    });
    expect(live.isConnected).toBe(true);
  });

  it('says what to do when nobody is found', async () => {
    const user = userEvent.setup();
    open('/settings/subject-access', { [SEARCH]: ok({ results: [], nextCursor: null }) });
    await heading('Subject access and erasure');

    await user.type(screen.getByLabelText('Name or email address'), 'nobody');
    await user.click(screen.getByRole('button', { name: 'Find person' }));

    expect(await screen.findByRole('heading', { name: 'No people found' })).toBeTruthy();
    expect(screen.getByText(/Check the spelling/)).toBeTruthy();
  });

  it('asks for a longer term before sending anything', async () => {
    const user = userEvent.setup();
    const sent = open('/settings/subject-access');
    await heading('Subject access and erasure');

    await user.type(screen.getByLabelText('Name or email address'), 'a');
    await user.click(screen.getByRole('button', { name: 'Find person' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sent.some(({ key }) => key === SEARCH)).toBe(false);
  });
});

describe('the person page', () => {
  it('names the person and says what an export holds', async () => {
    open(`/settings/subject-access/people/${PARTY}`);

    await heading('Amara Okafor');
    expect(screen.getByText(/every tool, including tools that are switched off/)).toBeTruthy();
    expect(screen.getByText(/special category data/)).toBeTruthy();
    expect(
      screen.getByText(/Only you can download it, and it is deleted after 7 days/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Erase personal data' }).getAttribute('href')).toBe(
      `/northfield/settings/subject-access/people/${PARTY}/erasure`,
    );
    await expectTitle('Subject access and erasure – Fairfold Grants console');
    expectNothingKept();
  });

  it('shows the same not found screen when the person cannot be read', async () => {
    open(`/settings/subject-access/people/${PARTY}`, {
      [`GET /console/crm/people/${PARTY}`]: problem(404, 'Not found.'),
    });
    expect(await heading('Not found')).toBeTruthy();
  });

  it('says so when the record is already erased', async () => {
    open(`/settings/subject-access/people/${PARTY}`, {
      [`GET /console/crm/people/${PARTY}`]: ok({ state: 'erased' }),
    });
    expect(await screen.findByText(/merged into another or already erased/)).toBeTruthy();
  });

  it('creates an export after step-up, sending the party id only, and opens its status', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = open(`/settings/subject-access/people/${PARTY}`, {
      [REQUEST_EXPORT]: () => {
        calls += 1;
        return calls === 1
          ? problem(403, STEP_UP_NEEDED)
          : { status: 202, body: { requestId: REQUEST } };
      },
      [STEP_UP]: ok(administrator()),
      [READ_EXPORT]: ok({ ...requested, status: 'queued' }),
    });
    await heading('Amara Okafor');

    await user.click(screen.getByRole('button', { name: 'Create subject access export' }));
    await confirmItIsYou(user);

    await heading('Subject access export');
    expect(window.location.pathname).toBe(`/northfield/settings/subject-access/exports/${REQUEST}`);
    expect(sent.filter(({ key }) => key === REQUEST_EXPORT).map(({ body }) => body)).toEqual([
      { partyId: PARTY },
      { partyId: PARTY },
    ]);
    expectNothingKept();
  });

  it('says how long to wait after too many attempts', async () => {
    const user = userEvent.setup();
    open(`/settings/subject-access/people/${PARTY}`, {
      [REQUEST_EXPORT]: { ...problem(429, 'Too many requests.'), headers: { 'retry-after': '45' } },
    });
    await heading('Amara Okafor');

    await user.click(screen.getByRole('button', { name: 'Create subject access export' }));

    expect(
      await screen.findByText('Too many attempts. Wait 45 seconds, then try again.'),
    ).toBeTruthy();
  });
});

describe('the export status page', () => {
  const at = (answer: unknown) =>
    open(`/settings/subject-access/exports/${REQUEST}`, { [READ_EXPORT]: ok(answer) });

  it('says an export is queued', async () => {
    at({ ...requested, status: 'queued' });
    expect(await screen.findByText('Your export is queued')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();
  });

  it('says an export is running', async () => {
    at({ ...requested, status: 'running' });
    expect(await screen.findByText('Your export is being made')).toBeTruthy();
  });

  it('offers a plain link to download when ready, with the expiry in UK time', async () => {
    at({ ...requested, status: 'ready', fileId: FILE, expiresAt: '2026-11-17T09:30:00.000Z' });

    const link = await screen.findByRole('link', { name: 'Download export (JSON)' });
    expect(link.getAttribute('href')).toBe(`/api/console/files/${FILE}`);
    expect(link.getAttribute('download')).toBeNull();
    expect(screen.getByText(/17 November 2026, 9:30am UK time/)).toBeTruthy();
    expect(screen.getByText(/Only you can download it/)).toBeTruthy();
  });

  it('says what to do when it failed', async () => {
    at({ ...requested, status: 'failed', failureCode: 'job_failed' });
    expect(await screen.findByText('The export could not be made')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find a person' })).toBeTruthy();
  });

  it('says an expired file has been deleted and offers a new export', async () => {
    at({ ...requested, status: 'expired' });
    expect(await screen.findByText('This export has been deleted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find a person' })).toBeTruthy();
  });

  it('shows the same not found screen for another members request', async () => {
    open(`/settings/subject-access/exports/${REQUEST}`, {
      [READ_EXPORT]: problem(404, 'Not found.'),
    });
    expect(await heading('Not found')).toBeTruthy();
    expect(screen.queryByText(/request/i)).toBeNull();
  });

  it('shows not found for an address that is not an id, without asking the server', async () => {
    const sent = open('/settings/subject-access/exports/abc');
    expect(await heading('Not found')).toBeTruthy();
    expect(sent.some(({ key }) => key.startsWith('GET /console/subject-access'))).toBe(false);
  });

  it('reads again while it runs and announces the change to ready once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const sent = open(`/settings/subject-access/exports/${REQUEST}`, {
      [READ_EXPORT]: () => {
        reads += 1;
        return ok(
          reads === 1
            ? { ...requested, status: 'running' }
            : {
                ...requested,
                status: 'ready',
                fileId: FILE,
                expiresAt: '2026-11-17T09:30:00.000Z',
              },
        );
      },
    });
    await screen.findByText('Your export is being made');
    const live = screen.getAllByRole('status').find((node) => node.classList.contains('sr-only'));
    expect(live?.textContent).toBe('');

    await vi.advanceTimersByTimeAsync(3100);

    await screen.findByRole('link', { name: 'Download export (JSON)' });
    await waitFor(() => {
      expect(live?.textContent).toBe('Your export is ready to download.');
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.filter(({ key }) => key === READ_EXPORT)).toHaveLength(2);
    expect(within(document.body).getAllByRole('status').length).toBeGreaterThan(0);
  });

  it.each([
    ['failed', { failureCode: 'job_failed' }, 'The export could not be made.'],
    ['expired', {}, 'This export has been deleted.'],
  ])('announces the change to %s once', async (status, extra, words) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    open(`/settings/subject-access/exports/${REQUEST}`, {
      [READ_EXPORT]: () => {
        reads += 1;
        return ok(
          reads === 1 ? { ...requested, status: 'running' } : { ...requested, status, ...extra },
        );
      },
    });
    await screen.findByText('Your export is being made');
    const live = screen.getAllByRole('status').find((node) => node.classList.contains('sr-only'));

    await vi.advanceTimersByTimeAsync(3100);

    await waitFor(() => {
      expect(live?.textContent).toBe(words);
    });
  });

  it('does not read again when it is already final', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sent = at({ ...requested, status: 'expired' });
    await screen.findByText('This export has been deleted');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.filter(({ key }) => key === READ_EXPORT)).toHaveLength(1);
  });

  it('shows a way to try again when the status cannot be read', async () => {
    open(`/settings/subject-access/exports/${REQUEST}`, {
      [READ_EXPORT]: problem(500, 'The service failed.'),
    });
    expect(await screen.findByText('The service failed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
