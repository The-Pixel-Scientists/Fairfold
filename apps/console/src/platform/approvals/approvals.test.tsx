// SPDX-License-Identifier: AGPL-3.0-or-later

import { approvalPageSchema, approvalRequestDetailSchema } from '@pixel-scientists/domain/workflow';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, northfield, problem, stubApi } from '../../testing/api.ts';
import type { Reply } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, heading, ok } from '../settings/testing.ts';
import { STEP_UP_NEEDED } from '../team/change.ts';
import { SETTINGS, STEP_UP } from '../team/testing.ts';

setUpConsoleTests();

const REQUEST = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const COLLEAGUE = '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70';
const LIST = 'GET /console/approvals';
const READ = `GET /console/approvals/${REQUEST}`;
const APPROVE = `POST /console/approvals/${REQUEST}/approve`;
const REJECT = `POST /console/approvals/${REQUEST}/reject`;

const summary = {
  id: REQUEST,
  definitionKey: 'grants.payment_run',
  definitionVersionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  stepId: 'payment_approval',
  subjectId: '2b3c4d5e-6f70-4a81-92a3-b4c5d6e7f809',
  status: 'pending',
  requiredApprovals: 2,
  approvals: 1,
  requestedBy: COLLEAGUE,
  requestedAt: '2026-11-20T14:05:00.000Z',
  dueAt: null,
  closedAt: null,
  closeReason: null,
} as const;

const detail = (change: Record<string, unknown> = {}) =>
  approvalRequestDetailSchema.parse({
    ...summary,
    decisions: [],
    canDecide: true,
    canWithdraw: false,
    ...change,
  });

const created = (body: unknown): Reply => ({ status: 201, body });

const page = (requests: readonly unknown[], nextCursor: string | null = null) =>
  ok(approvalPageSchema.parse({ requests, nextCursor }));

const base = {
  [SESSION]: ok(consoleSession()),
  [SETTINGS]: ok({
    name: 'Northfield Foundation',
    timeZone: 'Europe/London',
    fiscalYearStartMonth: 4,
  }),
};

type Handlers = Record<string, Reply | ((body: unknown) => Reply)>;

async function openRequest(more: Handlers) {
  const sent = stubApi({ ...base, ...more });
  openConsole(`/northfield/approvals/${REQUEST}`);
  await heading('Approval request');
  await screen.findByText('1 of 2 approvals');
  return sent;
}

describe('the approvals inbox', () => {
  it('lists the requests waiting, with a link to each', async () => {
    stubApi({ ...base, [LIST]: page([summary]) });
    openConsole('/northfield/approvals');
    await heading('Approvals');

    const row = within(await screen.findByRole('row', { name: /Payment approval/ }));
    expect(row.getByRole('link', { name: 'Payment approval' }).getAttribute('href')).toBe(
      `/northfield/approvals/${REQUEST}`,
    );
    expect(row.getByText('A colleague')).toBeTruthy();
    expect(row.getByText('1 of 2')).toBeTruthy();
    expect(row.getByText('20 November 2026, 2:05pm')).toBeTruthy();
    await expectTitle('Approvals – Fairfold Grants console');
  });

  it('says nothing is waiting when the list is empty', async () => {
    stubApi({ ...base, [LIST]: page([]) });
    openConsole('/northfield/approvals');
    expect(await screen.findByText('Nothing is waiting for you')).toBeTruthy();
  });

  it('loads more when there is another page', async () => {
    const user = userEvent.setup();
    const second = {
      ...summary,
      id: '3c4d5e6f-7081-4a92-8ab3-c4d5e6f70819',
      stepId: 'refund_approval',
    };
    stubApi({
      ...base,
      [LIST]: (): Reply => page([summary], 'next_page'),
      'GET /console/approvals?cursor=next_page': page([second]),
    });
    openConsole('/northfield/approvals');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Refund approval' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows the not-found page without the read permission', async () => {
    stubApi({ ...base, [SESSION]: ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole('/northfield/approvals');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});

describe('an approval request', () => {
  it('shows no decision buttons to the requester, and says why', async () => {
    await openRequest({
      [READ]: ok(detail({ requestedBy: northfield.id, canDecide: false, canWithdraw: true })),
    });
    expect(
      screen.getByText('You made this request, so someone else must approve it.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve request' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeTruthy();
  });

  it('approves after the person confirms it is them, and says so once', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const sent = await openRequest({
      [READ]: ok(detail()),
      [APPROVE]: () => {
        calls += 1;
        return calls === 1
          ? problem(403, STEP_UP_NEEDED)
          : created(
              detail({
                status: 'approved',
                approvals: 2,
                canDecide: false,
                decisions: [
                  {
                    decidedBy: northfield.id,
                    outcome: 'approve',
                    reasonCode: null,
                    decidedAt: '2026-11-20T15:00:00.000Z',
                  },
                ],
              }),
            );
      },
      [STEP_UP]: ok(consoleSession()),
    });

    await user.click(screen.getByRole('button', { name: 'Approve request' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this request?' });
    await user.click(within(confirm).getByRole('button', { name: 'Approve request' }));
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('Request approved')).toBeTruthy();
    expect(screen.getByText('Approved', { selector: 'span' })).toBeTruthy();
    expect(sent.map(({ key }) => key).filter((key) => key.startsWith('POST /console'))).toEqual([
      APPROVE,
      APPROVE,
    ]);
    expect(window.location.search).toBe('');
  });

  it('rejects with a reason in the body and never in the address', async () => {
    const user = userEvent.setup();
    const sent = await openRequest({
      [READ]: ok(detail()),
      [REJECT]: created(detail({ status: 'rejected', canDecide: false })),
    });

    await user.click(screen.getByRole('button', { name: 'Reject request' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Reject this request?' }));
    await user.click(dialog.getByRole('button', { name: 'Reject request' }));
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect(sent.some(({ key }) => key === REJECT)).toBe(false);

    await user.click(dialog.getByRole('radio', { name: 'It is outside our policy' }));
    await user.click(dialog.getByRole('button', { name: 'Reject request' }));
    expect(await screen.findByText('Request rejected')).toBeTruthy();
    expect(sent.find(({ key }) => key === REJECT)?.body).toEqual({ reasonCode: 'outside_policy' });
    expect(window.location.href).not.toContain('outside_policy');
  });

  it('shows a refusal in the dialog and reads the request again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    await openRequest({
      [READ]: () => {
        reads += 1;
        return ok(reads === 1 ? detail() : detail({ canDecide: false, approvals: 2 }));
      },
      [APPROVE]: problem(409, 'Someone else has already decided this request.'),
    });

    await user.click(screen.getByRole('button', { name: 'Approve request' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Approve this request?' }));
    await user.click(dialog.getByRole('button', { name: 'Approve request' }));
    expect(await dialog.findByText('Someone else has already decided this request.')).toBeTruthy();
    expect(reads).toBe(2);
  });

  it('says the request is no longer available on a 404', async () => {
    const user = userEvent.setup();
    await openRequest({
      [READ]: ok(detail()),
      [APPROVE]: problem(404, 'Not found.'),
    });
    await user.click(screen.getByRole('button', { name: 'Approve request' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Approve this request?' }));
    await user.click(dialog.getByRole('button', { name: 'Approve request' }));
    expect(await dialog.findByText('This request is no longer available.')).toBeTruthy();
  });
});
