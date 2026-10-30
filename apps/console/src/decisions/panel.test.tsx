// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  api as submissionApi,
  detail,
  ok as okReply,
  page,
  programmes,
} from '../submissions/fixtures.ts';
import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, decision, list, manager, ok, row } from './fixtures.ts';

setUpConsoleTests();

const one = detail();
const DETAIL = `/northfield/submissions/${one.id}`;
const mine = (change = {}) => row(1, { organisation: one.organisation, ...change });

const detailReads = (found = list([mine()]), more = {}) => ({
  ...manager(),
  [submissionApi.programmes]: okReply(programmes),
  [submissionApi.stages]: okReply({ stages: [] }),
  [submissionApi.one(one.id)]: okReply(one),
  [submissionApi.files(one.id)]: okReply({ attachments: [] }),
  [submissionApi.list()]: okReply(page([one])),
  [submissionApi.assignments(one.id)]: ok({ assignments: [] }),
  [api.list]: ok(found),
  ...more,
});

const panel = () => screen.findByRole('region', { name: 'Decision' });

describe("a submission's decision", () => {
  it('says there is none yet and records one privately from the page', async () => {
    const user = userEvent.setup();
    let held = list([mine()]);
    const sent = stubApi(
      detailReads(held, {
        [api.list]: () => ok(held),
        [api.record(one.id)]: () => {
          held = list([mine({ decision: decision('accepted', {}, 15_000) })]);
          return ok(decision('accepted', {}, 15_000));
        },
      }),
    );
    openConsole(DETAIL);

    const region = await panel();
    expect(await within(region).findByText(/No decision yet/)).toBeTruthy();
    await user.click(within(region).getByRole('button', { name: 'Record decision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record decision' });
    await user.click(within(dialog).getByRole('radio', { name: /^Accepted/ }));
    await user.type(within(dialog).getByLabelText('Amount to award'), '15000');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));

    expect(await within(region).findByText('Award of £15,000')).toBeTruthy();
    expect(
      within(region).getByText('Private: the applicant sees nothing until decisions are released.'),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Change decision' })).toBeTruthy();
    expect(
      within(region).getByText(
        'Decision recorded for Harbourside Youth Project. Only staff can see it.',
      ),
    ).toBeTruthy();
    expect(sent.find(({ key }) => key === api.record(one.id))?.body).toEqual({
      outcome: 'accepted',
      amount: { amountMinor: 1_500_000, currency: 'GBP' },
    });
    expect(
      within(region)
        .getByRole('link', { name: 'All decisions in this round' })
        .getAttribute('href'),
    ).toBe(`/northfield/rounds/${one.round.id}/decisions`);
  });

  it('shows a released decision and does not offer to change it', async () => {
    stubApi(
      detailReads(
        list([
          mine({ decision: decision('declined', { releasedAt: '2026-11-25T09:00:00.000Z' }) }),
        ]),
      ),
    );
    openConsole(DETAIL);

    const region = await panel();
    expect(await within(region).findByText('Declined')).toBeTruthy();
    expect(within(region).getByText(/^Released on 25 November 2026/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: /decision$/ })).toBeNull();
  });

  it('does not offer a decision for a withdrawn submission', async () => {
    stubApi(
      detailReads(list([mine()]), {
        [submissionApi.one(one.id)]: okReply({ ...one, status: 'withdrawn' }),
      }),
    );
    openConsole(DETAIL);

    const region = await panel();
    expect(
      await within(region).findByText(
        'This submission was withdrawn, so it cannot be given a decision.',
      ),
    ).toBeTruthy();
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi(
      detailReads(list([mine()]), {
        [api.list]: () => {
          reads += 1;
          return reads === 1
            ? problem(503, 'The service is busy. Try again in a minute.')
            : ok(list([mine()]));
        },
      }),
    );
    openConsole(DETAIL);

    const region = await panel();
    expect(
      await within(region).findByText('The service is busy. Try again in a minute.'),
    ).toBeTruthy();
    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    expect(await within(region).findByRole('button', { name: 'Record decision' })).toBeTruthy();
  });

  it('is left out for someone who cannot record decisions', async () => {
    stubApi(
      detailReads(list([mine()]), {
        'GET /auth/session': ok({
          ...consoleSession(),
          permissions: ['grants.applications.read'],
        }),
      }),
    );
    openConsole(DETAIL);

    await screen.findByRole('region', { name: 'Organisation' });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Decision' })).toBeNull();
    });
  });
});
