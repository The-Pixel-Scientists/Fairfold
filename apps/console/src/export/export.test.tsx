// SPDX-License-Identifier: AGPL-3.0-or-later

import { SessionProvider } from '@pixel-scientists/ui';
import type { SessionData } from '@pixel-scientists/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BOARD_PACK_APPLICATIONS } from '@pixel-scientists/grants/contracts';
import { CreateBoardPack } from '../../../../modules/grants/src/console/export/CreateBoardPack.tsx';
import { ExportCsv } from '../../../../modules/grants/src/console/export/ExportCsv.tsx';

const view = '5d1c2b9a-3e4f-4a6b-8c7d-9e0f1a2b3c4d';
const request = '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10';
const file = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CSV_START = 'POST /api/console/csv-exports';
const CSV_STATUS = `GET /api/console/csv-exports/${request}`;
const PACK_START = 'POST /api/console/board-packs';
const PACK_STATUS = `GET /api/console/board-packs/${request}`;
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const membership = { id: uuid(1), tenant: { slug: 'northfield', name: 'Northfield Foundation' } };

let people = 0;

/** A different person each time, so a job held in memory by one test is not found by the next. */
const session = (permissions: readonly string[] = ['grants.data.export']): SessionData => ({
  mfa: 'complete',
  expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
  user: { email: `person-${String((people += 1))}@example.org` },
  permissions,
  activeMembership: membership,
  memberships: [membership],
});

interface Reply {
  status: number;
  body?: unknown;
}

const problem = (status: number, detail: string): Reply => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, detail, requestId: 'req_test' },
});

const queued = { id: request, requestedAt: '2026-12-17T10:00:00.000Z', status: 'queued' };
const running = { ...queued, status: 'running' };
const ready = { ...queued, status: 'ready', fileId: file, expiresAt: '2026-12-24T10:00:00.000Z' };
const accepted: Reply = { status: 202, body: { requestId: request } };
const status = (body: unknown): Reply => ({ status: 200, body });

interface Sent {
  key: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Answers each key with its replies in turn, and the last one for every read after. */
function stub(replies: Record<string, Reply[]>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url}`;
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ key, body, headers: init.headers as Record<string, string> });
      const queue = replies[key] ?? [];
      const reply = queue.length > 1 ? queue.shift() : queue[0];
      if (reply === undefined) return Promise.reject(new Error(`Unexpected request: ${key}`));
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return sent;
}

const count = (sent: Sent[], key: string) => sent.filter((item) => item.key === key).length;

async function show(ui: ReactNode, data: SessionData = session()) {
  render(
    <SessionProvider load={() => Promise.resolve(data)} signOut={() => Promise.resolve()}>
      {ui}
    </SessionProvider>,
  );
  await act(async () => {});
}

async function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await act(async () => {});
}

const later = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const heard = () => screen.getByRole('status').textContent;

const csv = <ExportCsv viewId={view} unsaved={false} />;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Export as CSV', () => {
  it('sends the view id only, and a double click starts one job', async () => {
    const sent = stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(queued)] });
    await show(csv);

    fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));
    await act(async () => {});

    const posts = sent.filter((item) => item.key === CSV_START);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ viewId: view });
    expect(posts[0]?.headers['Idempotency-Key']).toBeTruthy();
    expect(heard()).toBe('Your CSV export has started');
  });

  it('is not offered without a saved view, and says to save it first', async () => {
    stub({});
    await show(<ExportCsv viewId={null} unsaved={false} />);
    expect(screen.queryByRole('button', { name: 'Export as CSV' })).toBeNull();
    expect(screen.getByText('Save the view first, then export it as CSV.')).toBeTruthy();
  });

  it('says the export uses the saved version when there are unsaved changes', async () => {
    stub({});
    await show(<ExportCsv viewId={view} unsaved />);
    expect(screen.getByText(/uses the saved version of this view/)).toBeTruthy();
  });

  it('shows nothing without the permission', async () => {
    stub({});
    await show(csv, session(['grants.applications.read']));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Save the view first/)).toBeNull();
  });

  it('follows the job to ready with a plain download link, then stops reading', async () => {
    const sent = stub({
      [CSV_START]: [accepted],
      [CSV_STATUS]: [status(queued), status(running), status(ready)],
    });
    await show(csv);
    await click('Export as CSV');
    expect(screen.getByText(/It will start in a moment/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Export as CSV' });
    button.focus();

    await later(3000);
    expect(screen.getByText(/This can take a few minutes/)).toBeTruthy();
    expect(heard()).toBe('Your CSV export has started');

    await later(4500);
    expect(heard()).toBe('Your CSV export is ready');
    const link = screen.getByRole('link', { name: 'Download CSV export' });
    expect(link.getAttribute('href')).toBe(`/api/console/files/${file}`);
    expect(
      screen.getByText('Available until 24 December 2026. Only you can download it.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(button);

    const total = count(sent, CSV_STATUS);
    await later(60_000);
    expect(count(sent, CSV_STATUS)).toBe(total);
  });

  it('waits longer between reads, never more often than every few seconds', async () => {
    const sent = stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(running)] });
    await show(csv);
    await click('Export as CSV');
    expect(count(sent, CSV_STATUS)).toBe(1);
    await later(2900);
    expect(count(sent, CSV_STATUS)).toBe(1);
    await later(200);
    expect(count(sent, CSV_STATUS)).toBe(2);
    await later(4300);
    expect(count(sent, CSV_STATUS)).toBe(2);
    await later(200);
    expect(count(sent, CSV_STATUS)).toBe(3);
  });

  it('says a failed job could not be made, in the catalogue words', async () => {
    const failed = { ...queued, status: 'failed', failureCode: 'requester_cannot_read' };
    stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(running), status(failed)] });
    await show(csv);
    await click('Export as CSV');
    await later(3000);
    expect(screen.getByText('The CSV export could not be made')).toBeTruthy();
    expect(heard()).toMatch(/^Your CSV export could not be made. You no longer have access/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says an expired job has been deleted', async () => {
    stub({
      [CSV_START]: [accepted],
      [CSV_STATUS]: [status(running), status({ ...queued, status: 'expired' })],
    });
    await show(csv);
    await click('Export as CSV');
    await later(3000);
    expect(screen.getByText('This CSV export has been deleted')).toBeTruthy();
    expect(heard()).toBe('Your CSV export has been deleted. Start a new one.');
  });

  it('shows a refused status as a plain error and does not read again', async () => {
    const detail = 'This export is not available. Start a new one.';
    const sent = stub({ [CSV_START]: [accepted], [CSV_STATUS]: [problem(404, detail)] });
    await show(csv);
    await click('Export as CSV');
    expect(screen.getByRole('alert').textContent).toContain(detail);
    await later(60_000);
    expect(count(sent, CSV_STATUS)).toBe(1);
  });

  it('shows refused starts once, whether a 403 or a rate limit', async () => {
    for (const [code, detail] of [
      [403, 'You cannot export data.'],
      [429, 'Too many exports. Try again in a minute.'],
    ] as const) {
      const sent = stub({ [CSV_START]: [problem(code, detail)] });
      await show(csv);
      await click('Export as CSV');
      expect(screen.getByRole('alert').textContent).toContain(detail);
      expect(count(sent, CSV_START)).toBe(1);
      cleanup();
    }
  });

  it('asks the person to confirm it is them when the route needs a recent sign-in', async () => {
    const sent = stub({
      [CSV_START]: [problem(403, STEP_UP_NEEDED), accepted],
      [CSV_STATUS]: [status(queued)],
    });
    await show(csv);
    await click('Export as CSV');
    expect(screen.getByRole('dialog', { name: 'Confirm it is you' })).toBeTruthy();
    expect(count(sent, CSV_START)).toBe(1);
  });

  it('stops reading when the page is left', async () => {
    const sent = stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(running)] });
    await show(csv);
    await click('Export as CSV');
    cleanup();
    await later(60_000);
    expect(count(sent, CSV_STATUS)).toBe(1);
  });

  it('keeps no id in the address, the title, web storage or a message', async () => {
    stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(ready)] });
    await show(csv);
    await click('Export as CSV');
    const everywhere = [
      window.location.href,
      document.title,
      JSON.stringify(Object.entries(localStorage)),
      JSON.stringify(Object.entries(sessionStorage)),
      heard(),
    ].join(' ');
    expect(everywhere).not.toContain(request);
    expect(everywhere).not.toContain(file);
  });

  it('shows the latest job again when the person comes back in the same session', async () => {
    stub({ [CSV_START]: [accepted], [CSV_STATUS]: [status(ready)] });
    const data = session();
    await show(csv, data);
    await click('Export as CSV');
    cleanup();

    await show(csv, data);
    expect(screen.getByRole('link', { name: 'Download CSV export' })).toBeTruthy();
    cleanup();

    await show(csv);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Create board pack', () => {
  const ids = [uuid(11), uuid(12), uuid(13)];

  it('sends the selected ids only and announces the start', async () => {
    const sent = stub({ [PACK_START]: [accepted], [PACK_STATUS]: [status(ready)] });
    await show(<CreateBoardPack selectedIds={ids} />);
    await click('Create board pack');

    expect(sent.find((item) => item.key === PACK_START)?.body).toEqual({ applicationIds: ids });
    expect(heard()).toBe('Your board pack is being created');
    expect(screen.getByRole('link', { name: 'Download board pack' })).toBeTruthy();
  });

  it('refuses a selection over the cap before sending, and says how many to deselect', async () => {
    const sent = stub({});
    const many = Array.from({ length: MAX_BOARD_PACK_APPLICATIONS + 3 }, (_, n) => uuid(n + 1));
    await show(<CreateBoardPack selectedIds={many} />);
    await click('Create board pack');

    expect(screen.getByRole('alert').textContent).toContain('Deselect 3');
    expect(sent).toEqual([]);
  });

  it('is disabled with nothing selected, and absent without the permission', async () => {
    stub({});
    await show(<CreateBoardPack selectedIds={[]} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Create board pack' });
    expect(button.disabled).toBe(true);
    cleanup();
    await show(<CreateBoardPack selectedIds={ids} />, session(['grants.applications.read']));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
