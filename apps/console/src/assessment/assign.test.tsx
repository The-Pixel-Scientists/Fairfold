// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  api as submissionApi,
  detail,
  listReads,
  ok as okReply,
  page,
  programmes,
  summary,
} from '../submissions/fixtures.ts';
import { problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, assignment, ids, manager, ok, people } from './fixtures.ts';

setUpConsoleTests();

const inReview = { stage: { id: ids.review, name: 'Review' } };
const one = detail(inReview);
const DETAIL = `/northfield/submissions/${one.id}`;

const pool = [
  { ...people.priya, openAssignments: 2, assignments: 2 },
  { ...people.tom, openAssignments: 0, assignments: 0 },
];

/** What the detail page reads for a submission in Review. */
const detailReads = (assignments: readonly object[] = [], extra = {}) => ({
  ...manager(),
  [submissionApi.programmes]: okReply(programmes),
  [submissionApi.stages]: okReply({ stages: [] }),
  [submissionApi.one(one.id)]: okReply(one),
  [submissionApi.files(one.id)]: okReply({ attachments: [] }),
  [submissionApi.list()]: okReply(page([one])),
  [submissionApi.assignments(one.id)]: ok({ assignments }),
  [api.pool]: ok({ reviewers: pool }),
  ...extra,
});

describe("a submission's reviewers", () => {
  it('lists who is assigned and where each stands, and says what to do when no one is', async () => {
    stubApi(
      detailReads([
        assignment(1),
        assignment(1, { id: ids.need, reviewer: people.tom, status: 'conflicted' }),
      ]),
    );
    openConsole(DETAIL);

    const panel = await screen.findByRole('region', { name: 'Reviewers' });
    expect(await within(panel).findAllByText('Priya Shah')).not.toHaveLength(0);
    expect(within(panel).getByText('Assigned')).toBeTruthy();
    expect(within(panel).getByText('Conflict declared')).toBeTruthy();
    // Only an assignment with no scores and no conflict can be removed.
    expect(
      within(panel).getAllByRole('button', { name: joined('Remove', 'Priya Shah') }),
    ).toHaveLength(1);
    expect(within(panel).getByRole('link', { name: 'Reviewer pool' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/reviewers`,
    );
    expect(within(panel).getByRole('link', { name: 'Score spread' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/score-spread`,
    );
  });

  it('says why the reviewers did not load and offers another go, without losing the submission', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi(
      detailReads([], {
        [submissionApi.assignments(one.id)]: () => {
          reads += 1;
          return reads === 1
            ? problem(503, 'The service is busy. Try again in a minute.')
            : ok({ assignments: [assignment(1)] });
        },
      }),
    );
    openConsole(DETAIL);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Harbourside Youth Project' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByText('Priya Shah')).not.toHaveLength(0);
  });

  it('says what to do when no one is assigned yet', async () => {
    stubApi(detailReads([]));
    openConsole(DETAIL);

    expect(
      await screen.findByText('No reviewers are assigned yet. Assign reviewers to start scoring.'),
    ).toBeTruthy();
  });

  it('assigns the reviewers chosen, leaving out those already assigned, and reads the list again', async () => {
    const user = userEvent.setup();
    let assigned = false;
    const sent = stubApi(
      detailReads([], {
        [submissionApi.assignments(one.id)]: () =>
          ok({
            assignments: assigned
              ? [assignment(1, { reviewer: people.tom, submissionId: one.id })]
              : [],
          }),
        [api.assign()]: () => {
          assigned = true;
          return ok({ assigned: 1 });
        },
      }),
    );
    openConsole(DETAIL);

    await user.click(await screen.findByRole('button', { name: 'Assign reviewers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign reviewers' });
    expect(within(dialog).getByText(/Choose who reviews this submission at Review/)).toBeTruthy();
    const priya = await within(dialog).findByRole('checkbox', { name: /Priya Shah/ });
    expect(priya.closest('div')?.textContent).toContain('2 open reviews');
    await user.click(await within(dialog).findByRole('checkbox', { name: /Tom Okafor/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign 1 reviewer' }));

    expect(await screen.findByText('1 review assigned.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.assign())?.body).toEqual({
      submissionIds: [one.id],
      membershipIds: [people.tom.membershipId],
    });
    expect(
      await within(screen.getByRole('region', { name: 'Reviewers' })).findAllByText('Tom Okafor'),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not offer a reviewer who is already assigned', async () => {
    const user = userEvent.setup();
    stubApi(detailReads([assignment(1)]));
    openConsole(DETAIL);

    await user.click(await screen.findByRole('button', { name: 'Assign reviewers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign reviewers' });
    expect(await within(dialog).findByRole('checkbox', { name: /Tom Okafor/ })).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox', { name: /Priya Shah/ })).toBeNull();
  });

  it('sends a manager with an empty pool to set it up', async () => {
    const user = userEvent.setup();
    stubApi(detailReads([], { [api.pool]: ok({ reviewers: [] }) }));
    openConsole(DETAIL);

    await user.click(await screen.findByRole('button', { name: 'Assign reviewers' }));
    const link = await screen.findByRole('link', { name: 'Set up reviewers' });
    expect(link.getAttribute('href')).toBe(`/northfield/rounds/${ids.round}/reviewers`);
  });

  it('says why the API refused, and keeps the choice', async () => {
    const user = userEvent.setup();
    stubApi(
      detailReads([], {
        [api.assign()]: problem(409, 'This submission is not at a review stage.'),
      }),
    );
    openConsole(DETAIL);

    await user.click(await screen.findByRole('button', { name: 'Assign reviewers' }));
    await user.click(await screen.findByRole('checkbox', { name: /Tom Okafor/ }));
    await user.click(screen.getByRole('button', { name: 'Assign 1 reviewer' }));

    expect((await screen.findByRole('alert')).textContent).toContain('not at a review stage');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Tom Okafor/ }).checked).toBe(
      true,
    );
  });

  it('removes an assignment that has not been scored, after asking', async () => {
    const user = userEvent.setup();
    let removed = false;
    const sent = stubApi(
      detailReads([], {
        [submissionApi.assignments(one.id)]: () =>
          ok({ assignments: removed ? [] : [assignment(1)] }),
        [api.unassign(assignment(1).id)]: () => {
          removed = true;
          return { status: 204 };
        },
      }),
    );
    openConsole(DETAIL);

    await user.click(await screen.findByRole('button', { name: joined('Remove', 'Priya Shah') }));
    const dialog = screen.getByRole('dialog', { name: 'Remove Priya Shah from this submission?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove reviewer' }));

    expect(await screen.findByText('Priya Shah removed from this submission.')).toBeTruthy();
    expect(sent.some(({ key }) => key === api.unassign(assignment(1).id))).toBe(true);
  });
});

const listed = [
  summary(1, inReview),
  summary(2, inReview),
  summary(3), // Intake
];

const listPage = (names: readonly object[] = listed) => ({
  ...listReads(names as never),
  [api.pool]: ok({ reviewers: pool }),
});

const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const bar = () => within(screen.getByRole('group', { name: 'Bulk actions' }));

describe('assigning from the list', () => {
  it('assigns reviewers to the chosen submissions, and says what the button will do', async () => {
    const user = userEvent.setup();
    const sent = stubApi({ ...listPage(), [api.assign()]: ok({ assigned: 4 }) });
    openConsole('/northfield/submissions');
    await screen.findByRole('table', { name: 'Submissions' });

    expect(
      bar().getByRole<HTMLButtonElement>('button', { name: 'Assign reviewers' }).disabled,
    ).toBe(true);
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(box('Select Millbrook Allotment Society'));
    await user.click(bar().getByRole('button', { name: 'Assign reviewers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Assign reviewers' });
    expect(within(dialog).getByText(/Choose who reviews 2 submissions at Review/)).toBeTruthy();
    await user.click(await within(dialog).findByRole('checkbox', { name: /Priya Shah/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Tom Okafor/ }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Assign 2 reviewers to 2 submissions' }),
    );

    const status = await screen.findByText('4 reviews assigned.');
    expect(document.activeElement).toBe(status);
    expect(sent.find(({ key }) => key === api.assign())?.body).toEqual({
      submissionIds: [listed[0]?.id, listed[1]?.id],
      membershipIds: [people.priya.membershipId, people.tom.membershipId],
    });
    expect(bar().getByText('Select submissions to act on several at once.')).toBeTruthy();
  });

  it('says submissions in different stages are assigned stage by stage', async () => {
    const user = userEvent.setup();
    stubApi(listPage());
    openConsole('/northfield/submissions');
    await screen.findByRole('table', { name: 'Submissions' });

    await user.click(box('Select Harbourside Youth Project'));
    await user.click(box('Select Northfield Lunch Club'));
    await user.click(bar().getByRole('button', { name: 'Assign reviewers' }));

    const dialog = await screen.findByRole('dialog', { name: 'Assign reviewers' });
    expect(within(dialog).getByText(/not all in the same one/)).toBeTruthy();
    expect(within(dialog).getByText(/Filter the list by stage/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('links to the pool and the spread of the round the list is filtered by', async () => {
    stubApi({
      ...listPage(),
      [submissionApi.list(`?roundId=${ids.round}`)]: okReply(page(listed)),
    });
    openConsole(`/northfield/submissions?roundId=${ids.round}`);

    expect((await screen.findByRole('link', { name: 'Reviewers' })).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/reviewers`,
    );
    expect(screen.getByRole('link', { name: 'Score spread' }).getAttribute('href')).toBe(
      `/northfield/rounds/${ids.round}/score-spread`,
    );
  });
});

describe('assigning automatically', () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('table', { name: 'Submissions' });
    await user.click(box('Select Harbourside Youth Project'));
    await user.click(box('Select Millbrook Allotment Society'));
    await user.click(bar().getByRole('button', { name: 'Assign automatically' }));
    return screen.findByRole('dialog', { name: 'Assign automatically' });
  }

  it('asks how many reviewers each needs, then reports what was assigned and what could not be', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...listPage(),
      [api.automatic()]: ok({
        assigned: 3,
        unfilled: [{ submissionId: listed[1]?.id, missing: 1 }],
      }),
    });
    openConsole('/northfield/submissions');
    const dialog = await open(user);

    expect(
      within(dialog).getByRole<HTMLSelectElement>('combobox', {
        name: 'Reviewers for each submission',
      }).value,
    ).toBe('2');
    await user.selectOptions(within(dialog).getByRole('combobox'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Assign 3 reviewers to each' }));

    const result = await within(dialog).findByRole('status');
    expect(document.activeElement).toBe(result);
    expect(result.textContent).toContain('3 reviews assigned.');
    expect(result.textContent).toContain('1 submission could not get all the reviewers asked for');
    expect(result.textContent).toContain('Millbrook Allotment Society needs 1 more reviewer');
    expect(sent.find(({ key }) => key === api.automatic())?.body).toEqual({
      submissionIds: [listed[0]?.id, listed[1]?.id],
      reviewersPerSubmission: 3,
    });

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      screen.getByText(
        '3 reviews assigned. 1 submission could not get all the reviewers asked for.',
      ),
    ).toBeTruthy();
  });

  it('says why the API refused', async () => {
    const user = userEvent.setup();
    stubApi({
      ...listPage(),
      [api.automatic()]: problem(409, 'This stage has no rubric, so it cannot be reviewed.'),
    });
    openConsole('/northfield/submissions');
    const dialog = await open(user);

    await user.click(within(dialog).getByRole('button', { name: 'Assign 2 reviewers to each' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('has no rubric');
  });
});
