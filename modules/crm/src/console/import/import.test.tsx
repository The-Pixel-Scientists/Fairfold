// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetNames } from '../labels.tsx';
import {
  id,
  open,
  organisationRecord,
  problem,
  refreshedSession,
  session,
  STEP_UP_NEEDED,
  stubFetch,
} from '../harness.test.tsx';

const JOB = id(30);
const runner = session(['crm.imports.run']);

const job = {
  id: JOB,
  target: 'organisation',
  state: 'ready',
  failure: null,
  rows: { total: 6, valid: 3, withErrors: 1, duplicates: 2 },
  result: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  completedAt: null,
};

const rows = {
  rows: [
    { row: 2, status: 'valid', values: { name: 'Riverside Trust' }, errors: [], duplicates: [] },
    {
      row: 14,
      status: 'error',
      values: { identifier: 'SECRET-CELL' },
      errors: [{ field: 'identifier', code: 'not_valid' }],
      duplicates: [],
    },
    {
      row: 15,
      status: 'duplicate',
      values: { name: 'Riverside Club' },
      errors: [],
      duplicates: [{ partyId: id(5), signals: ['name'] }],
    },
  ],
  nextCursor: null,
};

const jobKey = `GET /console/crm/imports/${JOB}`;

beforeEach(() => {
  forgetNames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('import', () => {
  it('names the row and field of each error from the catalogue, and never shows a cell', async () => {
    stubFetch({
      [jobKey]: { status: 200, body: job },
      [`${jobKey}/rows`]: { status: 200, body: rows },
      [`GET /console/crm/organisations/${id(5)}`]: {
        status: 200,
        body: organisationRecord('Riverside Club'),
      },
    });
    open(`/crm/imports/${JOB}`, runner);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Import organisations' }),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'Row 14, identifier: Correct this value in the file so it is in the expected format.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Ready to import')).toBeTruthy();
    expect(document.body.textContent).not.toContain('SECRET-CELL');
    expect(screen.getByText(/Skip 1 row with errors/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import 3 organisations' })).toBeTruthy();
  });

  it('offers the skip options in words and confirms behind step-up with one key', async () => {
    let confirms = 0;
    const sent = stubFetch({
      [jobKey]: { status: 200, body: job },
      [`${jobKey}/rows`]: { status: 200, body: rows },
      [`GET /console/crm/organisations/${id(5)}`]: {
        status: 200,
        body: organisationRecord('Riverside Club'),
      },
      [`POST /console/crm/imports/${JOB}/confirmation`]: () => {
        confirms += 1;
        return confirms === 1
          ? problem(403, STEP_UP_NEEDED)
          : { status: 200, body: { created: 5, skippedErrors: 1, skippedDuplicates: 0 } };
      },
      'POST /auth/step-up': { status: 200, body: refreshedSession(['crm.imports.run']) },
    });
    const user = userEvent.setup();
    open(`/crm/imports/${JOB}`, runner);

    await user.click(await screen.findByRole('radio', { name: 'Add 2 rows as new records' }));
    await user.click(screen.getByRole('button', { name: 'Import 5 organisations' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(stepUp).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(stepUp).getByLabelText('Code from your authenticator app'), '123456');
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('Imported 5 organisations')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: 'Imported 5 organisations' }),
    );
    expect(screen.getByRole('link', { name: 'Open records' })).toBeTruthy();
    const posts = sent.filter(({ key }) => key.endsWith('/confirmation'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toEqual({ duplicates: 'create' });
    expect(posts[0]?.headers['Idempotency-Key']).toBe(posts[1]?.headers['Idempotency-Key']);
  });

  it('says why a file could not be used and what to do', async () => {
    stubFetch({
      [jobKey]: { status: 200, body: { ...job, state: 'failed', failure: 'too_large' } },
    });
    open(`/crm/imports/${JOB}`, runner);
    expect(
      await screen.findByText(
        'The file is larger than 5 MB. Split it into smaller files and upload each one.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it('reports progress in words while the file is checked', async () => {
    stubFetch({ [jobKey]: { status: 200, body: { ...job, state: 'checking' } } });
    open(`/crm/imports/${JOB}`, runner);
    const status = await screen.findByText('Checking the file');
    expect(status.getAttribute('role')).toBe('status');
  });

  it('shows the result of a finished import when it is opened again', async () => {
    stubFetch({
      [jobKey]: {
        status: 200,
        body: { ...job, state: 'completed', result: { created: 3, skipped: 3 } },
      },
    });
    open(`/crm/imports/${JOB}`, runner);
    expect(await screen.findByText('Imported 3 organisations')).toBeTruthy();
  });

  it('shows the not-found page to a member who may not import, without a request', async () => {
    const sent = stubFetch({});
    open(`/crm/imports/${JOB}`, session([]));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    await waitFor(() => {
      expect(sent).toHaveLength(0);
    });
  });
});
