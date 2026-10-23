// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stored } from '../forms/fixtures.ts';
import { SESSION } from '../programme/fixtures.ts';
import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { joined } from '../testing/names.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
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
  uuid,
} from './fixtures.ts';

setUpConsoleTests();

const one = detail();
const PATH = `/northfield/submissions/${one.id}`;

/** What the page reads for a submission, and the list its neighbours come from. */
const reads = (submission = one, list = page([summary(2), summary(1), summary(3)])) => ({
  ...manager(),
  [api.programmes]: ok(programmes),
  [api.stages]: ok({ stages }),
  [api.one(submission.id)]: ok(submission),
  [api.files(submission.id)]: ok({ attachments: [] }),
  [api.list()]: ok(list),
});

describe('a submission', () => {
  it('opens with the organisation, where it stands and what to do next', async () => {
    stubApi(reads());
    openConsole(PATH);

    expect(await heading('Harbourside Youth Project')).toBeTruthy();
    expect(screen.getByText('Community Spaces Fund, Autumn 2026')).toBeTruthy();
    const stagesList = await screen.findByRole('list', { name: 'Stages' });
    expect(
      within(stagesList)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Intake, done', 'Review, current stage', 'Decision, not started']);
    expect(within(stagesList).getByText('Review').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    );
    expect(screen.getByText('Ready to move on')).toBeTruthy();
    await expectTitle('Submission – Fairfold Grants console');
  });

  it('goes back to the list with its filters and page', async () => {
    const search = `?status=submitted&cursor=abc_1`;
    stubApi({ ...reads(), [api.list(search)]: ok(page([summary(1)])) });
    openConsole(`${PATH}${search}`);

    const breadcrumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumbs).getByRole('link', { name: 'Submissions' }).getAttribute('href'),
    ).toBe(`/northfield/submissions${search}`);
  });

  it('shows the answers by section, only what the form asks, with the questions that depend on an answer', async () => {
    stubApi(reads());
    openConsole(PATH);

    const panel = await screen.findByRole('tabpanel', { name: 'Application' });
    expect(
      within(panel).getByText(/What was submitted on .*, on version 3 of the form\./),
    ).toBeTruthy();
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'About your organisation' }),
    ).toBeTruthy();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Your project' })).toBeTruthy();
    expect(within(panel).getByText('Riverside Lunch Club')).toBeTruthy();
    expect(within(panel).getByText('Is your organisation a registered charity?')).toBeTruthy();
    expect(within(panel).getByText('Yes')).toBeTruthy();
    expect(within(panel).getByText('Registered charity number')).toBeTruthy();
    expect(within(panel).getByText('Building work')).toBeTruthy();
  });

  it('leaves out a question the answers show was not asked', async () => {
    stubApi(reads(detail({ answers: { f_charity: false } })));
    openConsole(PATH);

    const panel = await screen.findByRole('tabpanel', { name: 'Application' });
    expect(within(panel).getByText('Is your organisation a registered charity?')).toBeTruthy();
    expect(within(panel).queryByText('Registered charity number')).toBeNull();
  });

  it('lists the files on a file question, each a download link made from ids', async () => {
    const definition = stored({
      sections: [
        {
          id: 's_docs',
          title: 'Documents',
          fields: [
            {
              id: 'f_accounts',
              type: 'file',
              label: 'Latest accounts',
              required: true,
              allowedTypes: ['application/pdf'],
              maxBytes: 5_000_000,
              maxFiles: 1,
            },
          ],
        },
      ],
    });
    const fileId = uuid(500);
    stubApi({
      ...reads(detail({ form: { ...one.form, definition }, answers: {} })),
      [api.files(one.id)]: ok({
        attachments: [
          {
            id: fileId,
            fieldId: 'f_accounts',
            name: 'accounts-2026.pdf',
            type: 'application/pdf',
            bytes: 2048,
            uploadedAt: '2026-10-20T12:00:00.000Z',
          },
        ],
      }),
    });
    openConsole(PATH);

    const link = await screen.findByRole('link', { name: /Download accounts-2026\.pdf/ });
    expect(link.getAttribute('href')).toBe(`/api/console/submissions/${one.id}/files/${fileId}`);
  });

  it('shows the organisation with each identifier and whether it is verified, and the contact', async () => {
    stubApi(reads());
    openConsole(PATH);

    const organisation = within(await screen.findByRole('region', { name: 'Organisation' }));
    expect(organisation.getByText('Charitable incorporated organisation')).toBeTruthy();
    expect(organisation.getByText('GB-CHC')).toBeTruthy();
    expect(organisation.getByText('Verified')).toBeTruthy();
    expect(organisation.getByText('Not verified')).toBeTruthy();
    const contact = within(screen.getByRole('region', { name: 'Contact' }));
    expect(contact.getByText('Sam Patel')).toBeTruthy();
    expect(contact.getByRole('link', { name: 'sam@riverside.example' }).getAttribute('href')).toBe(
      'mailto:sam@riverside.example',
    );
  });

  it('says a contact has no name when the record has none', async () => {
    stubApi(
      reads(
        detail({
          contact: {
            personId: uuid(400),
            givenName: null,
            familyName: null,
            email: 'sam@riverside.example',
          },
        }),
      ),
    );
    openConsole(PATH);

    const contact = within(await screen.findByRole('region', { name: 'Contact' }));
    expect(contact.getByText('Not given')).toBeTruthy();
  });

  it('shows each eligibility check with its date, and the question that stopped the applicant', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(
        detail({
          eligibility: 'stopped',
          eligibilityChecks: [
            { outcome: 'stopped', fieldId: 'f_charity', checkedAt: '2026-10-21T12:00:00.000Z' },
            { outcome: 'eligible', fieldId: null, checkedAt: '2026-10-20T12:30:00.000Z' },
          ],
        }),
      ),
    );
    openConsole(PATH);
    await screen.findByRole('tabpanel', { name: 'Application' });

    await user.click(screen.getByRole('tab', { name: 'Eligibility' }));

    const panel = screen.getByRole('tabpanel', { name: 'Eligibility' });
    const stop = within(
      within(panel).getByRole('region', { name: 'Where the applicant was stopped' }),
    );
    expect(stop.getByText('Is your organisation a registered charity?')).toBeTruthy();
    expect(stop.getByText('We only fund registered charities.')).toBeTruthy();
    const table = within(
      within(panel).getByRole('table', { name: 'Eligibility checks, latest first' }),
    );
    const rows = table.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(/^21 October 2026/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Not eligible')).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByText('Is your organisation a registered charity?'),
    ).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Eligible')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Not stopped')).toBeTruthy();
  });

  it('says so when no eligibility check is on record', async () => {
    const user = userEvent.setup();
    stubApi(reads(detail({ eligibility: null, eligibilityChecks: [] })));
    openConsole(PATH);
    await screen.findByRole('tabpanel', { name: 'Application' });

    await user.click(screen.getByRole('tab', { name: 'Eligibility' }));

    expect(
      screen.getByRole('heading', { level: 2, name: 'No eligibility check yet' }),
    ).toBeTruthy();
  });

  it('shows the history as a timeline, newest first, with who did each thing', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(
        detail({
          history: [
            ...one.history,
            { event: 'withdrawn', at: '2026-10-23T10:00:00.000Z', by: null },
          ],
          withdrawnAt: '2026-10-23T10:00:00.000Z',
          status: 'withdrawn',
        }),
      ),
    );
    openConsole(PATH);
    await screen.findByRole('tabpanel', { name: 'Application' });

    await user.click(screen.getByRole('tab', { name: 'History' }));

    const timeline = screen.getByRole('list', { name: 'History, newest first' });
    const entries = within(timeline).getAllByRole('listitem');
    expect(entries.map((entry) => entry.querySelector('p')?.textContent)).toEqual([
      'Withdrawn by the applicant',
      'Moved from Intake to Review',
      'Entered Intake',
      'Submitted',
    ]);
    expect(entries[0]?.textContent).toContain('Name not on record');
    expect(entries[1]?.textContent).toContain('Ada Reed');
    expect(screen.getByText(/^Withdrawn on 23 October 2026/)).toBeTruthy();
  });

  it('is marked late when it came in after the closing time', async () => {
    stubApi(reads(detail({ late: true })));
    openConsole(PATH);

    await heading('Harbourside Youth Project');
    expect(screen.getByText('Late')).toBeTruthy();
  });
});

describe('moving through the list', () => {
  const step = (direction: 'Previous' | 'Next') =>
    screen.findByRole('link', { name: joined(direction, 'submission') });

  it('links to the submissions either side in the list it was opened from', async () => {
    const [before, after] = [summary(2), summary(3)];
    stubApi(reads(one, page([before, summary(1), after])));
    openConsole(PATH);

    expect((await step('Previous')).getAttribute('href')).toBe(
      `/northfield/submissions/${before.id}`,
    );
    expect((await step('Next')).getAttribute('href')).toBe(`/northfield/submissions/${after.id}`);
    expect(screen.getByRole('navigation', { name: 'Submissions in this list' })).toBeTruthy();
  });

  it('keeps the filters in those links', async () => {
    const search = '?status=submitted';
    stubApi({ ...reads(), [api.list(search)]: ok(page([summary(2), summary(1), summary(3)])) });
    openConsole(`${PATH}${search}`);

    expect((await step('Next')).getAttribute('href')).toBe(
      `/northfield/submissions/${summary(3).id}${search}`,
    );
  });

  it('goes on to the first submission of the next page from the last of this one', async () => {
    stubApi({
      ...reads(one, page([summary(2), summary(1)], { nextCursor: 'abc_1' })),
      [api.list('?cursor=abc_1')]: ok(page([summary(4)])),
    });
    openConsole(PATH);

    expect((await step('Next')).getAttribute('href')).toBe(
      `/northfield/submissions/${summary(4).id}?cursor=abc_1`,
    );
  });

  it('marks Previous unavailable at the start of the list, and keeps it in place', async () => {
    stubApi(reads(one, page([summary(1), summary(2)])));
    openConsole(PATH);
    await step('Next');

    const previous = screen.getByRole('button', { name: joined('Previous', 'submission') });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows neither as available when the submission is not in that list', async () => {
    stubApi(reads(one, page([summary(2), summary(3)])));
    openConsole(PATH);

    await heading('Harbourside Youth Project');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /submission$/ })).toHaveLength(2);
    });
    expect(screen.queryByRole('link', { name: /submission$/ })).toBeNull();
  });

  it('moves to the next submission and shows it', async () => {
    const user = userEvent.setup();
    const { organisation } = one;
    const next = detail({
      ...summary(3),
      organisation: { ...organisation, ...summary(3).organisation },
    });
    stubApi({
      ...reads(one, page([summary(1), summary(3)])),
      [api.one(next.id)]: ok(next),
      [api.files(next.id)]: ok({ attachments: [] }),
    });
    openConsole(PATH);

    await user.click(await step('Next'));

    expect(await heading('Northfield Lunch Club')).toBeTruthy();
    expect(window.location.pathname).toBe(`/northfield/submissions/${next.id}`);
  });
});

describe('when a submission cannot be shown', () => {
  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...manager(),
      [api.programmes]: ok(programmes),
      [api.list()]: ok(page([one])),
      [api.one(one.id)]: () => {
        reads += 1;
        return reads === 1 ? problem(404, 'There is no submission with this address.') : ok(one);
      },
      [api.files(one.id)]: ok({ attachments: [] }),
      [api.stages]: ok({ stages }),
    });
    openConsole(PATH);

    expect(await screen.findByText('There is no submission with this address.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Submission' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await heading('Harbourside Youth Project')).toBeTruthy();
  });

  it('shows page not found for an address that is not a real id', async () => {
    stubApi({ ...manager() });
    openConsole('/northfield/submissions/riverside');

    await heading('Page not found');
  });

  it('tells a person without the permission so, and asks the API for nothing', async () => {
    const sent = stubApi({ [SESSION]: ok(consoleSession({ roles: ['reviewer'] })) });
    openConsole(PATH);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'You cannot view submissions' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).toEqual([SESSION]);
  });

  it('opens the submission on the stage path even when the round stages cannot be read', async () => {
    stubApi({ ...reads(), [api.stages]: problem(403, 'You cannot set up programmes.') });
    openConsole(PATH);

    expect(await heading('Harbourside Youth Project')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Stages' })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Application' })).toBeTruthy();
  });
});
