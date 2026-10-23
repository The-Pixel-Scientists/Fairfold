// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, criteria, ids, ok, review, reviewer, summary, uuid } from './fixtures.ts';

setUpConsoleTests();

const started = review({
  scores: [{ criterionId: ids.need, score: 4, comment: 'Local evidence.' }],
});
const PATH = `/northfield/reviews/${started.id}`;

const reads = (found = started, extra = {}) => ({
  ...reviewer(),
  [api.review(found.id)]: ok(found),
  ...extra,
});

const panel = () => screen.getByRole('region', { name: 'Your review' });
/** A criterion's comment box. Its name is "Comment", "on" and the criterion, in separate parts. */
const comment = (criterion: string) =>
  screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: (name) =>
      name.replaceAll(' ', '').startsWith(`Commenton${criterion.replaceAll(' ', '')}`),
  });
const heading = () => screen.findByRole('heading', { level: 1, name: 'Application 3F2A9C1B' });
const score = (criterion: string, value: number) =>
  within(
    screen.getByRole('radiogroup', { name: (label) => label.startsWith(criterion) }),
  ).getByRole<HTMLInputElement>('radio', { name: String(value) });

describe('the scoring workspace', () => {
  it('shows the application beside the criteria, without the organisation or anyone else', async () => {
    stubApi(reads());
    openConsole(PATH);

    await heading();
    expect(screen.getByRole('heading', { level: 2, name: 'Your project' })).toBeTruthy();
    expect(screen.getByText('We serve a hot lunch to forty older people every week.')).toBeTruthy();
    expect(screen.getByText(/Some answers are hidden from reviewers/)).toBeTruthy();
    expect(screen.queryByText(/Harbourside/)).toBeNull();
    expect(screen.getByText('Blind review, Community Spaces Fund, Autumn 2026')).toBeTruthy();
    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumbs).getByRole('link', { name: 'My reviews' })).toBeTruthy();

    // Each criterion is a radio group of its scale, with its guidance and a comment.
    for (const criterion of criteria) {
      const group = screen.getByRole('radiogroup', { name: new RegExp(`^${criterion.label}`) });
      expect(
        within(group)
          .getAllByRole('radio')
          .map((radio) => radio.getAttribute('value')),
      ).toEqual(['1', '2', '3', '4', '5']);
    }
    expect(
      screen.getByText(/Is there evidence of local need\? 1 is the lowest score/),
    ).toBeTruthy();
    expect(score('Need', 4).checked).toBe(true);
    expect(comment('Need')).toHaveProperty('value', 'Local evidence.');
    expect(within(panel()).getByText('1 of 3 scored', { exact: false })).toBeTruthy();
  });

  it('asks the reviewer to confirm they have no conflict before any scoring, with declaring as an equal choice', async () => {
    const user = userEvent.setup();
    stubApi(reads(review()));
    openConsole(PATH);

    await heading();
    expect(within(panel()).getByText(/check that you have no conflict of interest/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const none = within(panel()).getByRole('button', { name: 'I have no conflict, start scoring' });
    const declare = within(panel()).getByRole('button', { name: 'Declare a conflict' });
    expect(none.className).toBe(declare.className);

    await user.click(none);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Your review' }),
      );
    });
    expect(within(panel()).getByRole('button', { name: 'Submit review' })).toBeTruthy();
  });

  it('saves as the reviewer scores and says when it is saved', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(started, {
        [api.save(started.id)]: (body: unknown) =>
          ok({ scores: (body as { scores: unknown[] }).scores }),
      }),
    );
    openConsole(PATH);
    await heading();

    await user.click(score('Approach', 3));
    await user.type(comment('Approach'), 'Clear plan');

    expect(await within(panel()).findByText(/^Saved at /)).toBeTruthy();
    const saves = sent.filter(({ key }) => key === api.save(started.id));
    expect(saves).toHaveLength(1);
    expect(saves[0]?.body).toEqual({
      scores: [
        { criterionId: ids.need, score: 4, comment: 'Local evidence.' },
        { criterionId: ids.approach, score: 3, comment: 'Clear plan' },
      ],
    });
    expect(within(panel()).getByText('Weighted total so far (2 of 3 scored)')).toBeTruthy();
    expect(within(panel()).getByText('3.63 of 5')).toBeTruthy();
  });

  it('says a save failed and saves again on request', async () => {
    const user = userEvent.setup();
    let tries = 0;
    stubApi(
      reads(started, {
        [api.save(started.id)]: (body: unknown) => {
          tries += 1;
          return tries === 1
            ? problem(503, 'The service is busy. Try again in a minute.')
            : ok({ scores: (body as { scores: unknown[] }).scores });
        },
      }),
    );
    openConsole(PATH);
    await heading();

    await user.click(score('Value for money', 5));
    expect(
      await within(panel()).findByText('Not saved. Check your connection and try again'),
    ).toBeTruthy();
    await user.click(within(panel()).getByRole('button', { name: 'Try saving again' }));

    expect(await within(panel()).findByText(/^Saved at /)).toBeTruthy();
    expect(tries).toBe(2);
  });

  it('moves between criteria with Alt and the arrow keys, and gives a score with a number key', async () => {
    const user = userEvent.setup();
    stubApi(reads(started, { [api.save(started.id)]: ok({ scores: [] }) }));
    openConsole(PATH);
    await heading();

    score('Need', 4).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    // Approach has no score, so its first score takes focus.
    expect(document.activeElement).toBe(score('Approach', 1));
    await user.keyboard('2');
    expect(score('Approach', 2).checked).toBe(true);
    expect(document.activeElement).toBe(score('Approach', 2));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(document.activeElement).toBe(score('Value for money', 1));
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}{Alt>}{ArrowUp}{/Alt}{Alt>}{ArrowUp}{/Alt}');
    expect(document.activeElement).toBe(score('Need', 4));
    // A number outside the scale does nothing.
    await user.keyboard('9');
    expect(score('Need', 4).checked).toBe(true);
  });

  it('lists the criteria still to score when submitting too soon, and links to each', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    openConsole(PATH);
    await heading();

    expect(
      within(panel()).getByText('Still to score:', { exact: false }).closest('p')?.textContent,
    ).toBe('Still to score: Approach and Value for money');
    await user.click(within(panel()).getByRole('button', { name: 'Submit review' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Score every criterion to submit')).toBeTruthy();
    const links = within(alert).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Give Approach a score from 1 to 5',
      'Give Value for money a score from 1 to 5',
    ]);
    await user.click(links[0] as HTMLElement);
    expect(document.activeElement).toBe(score('Approach', 1));
    expect(within(panel()).getAllByText('Needs a score')).toHaveLength(2);
    expect(sent.some(({ key }) => key === api.submit(started.id))).toBe(false);
  });

  it('submits once every criterion is scored, then shows the scores as they stand', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(started, {
        [api.save(started.id)]: (body: unknown) =>
          ok({ scores: (body as { scores: unknown[] }).scores }),
        [api.submit(started.id)]: ok(
          summary(1, {
            status: 'submitted',
            progress: { scored: 3, total: 3 },
            submittedAt: '2026-10-25T10:00:00.000Z',
          }),
        ),
      }),
    );
    openConsole(PATH);
    await heading();

    await user.click(score('Approach', 3));
    await user.click(score('Value for money', 5));
    expect(
      within(panel()).getByText('Every criterion has a score. You can submit your review.'),
    ).toBeTruthy();
    await user.click(within(panel()).getByRole('button', { name: 'Submit review' }));

    const done = await within(panel()).findByText(/Your review is submitted on 25 October 2026/);
    expect(document.activeElement).toBe(done.closest('p'));
    expect(sent.find(({ key }) => key === api.submit(started.id))?.body).toEqual({
      scores: [
        { criterionId: ids.need, score: 4, comment: 'Local evidence.' },
        { criterionId: ids.approach, score: 3, comment: '' },
        { criterionId: ids.value, score: 5, comment: '' },
      ],
    });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(within(panel()).getByText('Local evidence.')).toBeTruthy();
    expect(within(panel()).getByText('Your weighted total')).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: 'Submit review' })).toBeNull();
    expect(within(panel()).getByRole('link', { name: 'Back to My reviews' })).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
  });

  it('opens a submitted review as it was submitted, with nothing to change', async () => {
    const submitted = review({
      status: 'submitted',
      submittedAt: '2026-10-25T10:00:00.000Z',
      progress: { scored: 3, total: 3 },
      scores: criteria.map((criterion) => ({ criterionId: criterion.id, score: 3, comment: '' })),
    });
    stubApi(reads(submitted));
    openConsole(`/northfield/reviews/${submitted.id}`);
    await heading();

    expect(within(panel()).getByText(/Your review is submitted on 25 October 2026/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'Declare a conflict' })).toBeNull();
  });

  it('says why a submit was refused and keeps the scores', async () => {
    const user = userEvent.setup();
    const all = review({
      scores: criteria.map((criterion) => ({ criterionId: criterion.id, score: 3, comment: '' })),
    });
    stubApi(
      reads(all, {
        [api.submit(all.id)]: problem(409, 'This review has already been submitted.'),
      }),
    );
    openConsole(`/northfield/reviews/${all.id}`);
    await heading();

    await user.click(within(panel()).getByRole('button', { name: 'Submit review' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already been submitted');
    expect(score('Need', 3).checked).toBe(true);
  });
});

describe('declaring a conflict', () => {
  const declared = (id: string) => ({
    [api.conflict(id)]: { status: 204 },
    [api.reviews]: ok({ reviews: [] }),
  });

  it('explains what follows, ends the assignment and returns to My reviews', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads(started, declared(started.id)));
    openConsole(PATH);
    await heading();

    await user.click(within(panel()).getByRole('button', { name: 'Declare a conflict' }));
    const dialog = screen.getByRole('dialog', { name: 'Declare a conflict of interest' });
    expect(
      within(dialog).getByText(/removed from My reviews and you cannot open it again/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/deleted/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep reviewing' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Declare a conflict' }));

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        '/northfield/reviews?conflict=declared',
      );
    });
    expect(sent.some(({ key }) => key === api.conflict(started.id))).toBe(true);
    expect(await screen.findByText(/You declared a conflict/)).toBeTruthy();
  });

  it('is an equal choice at the start, before any scoring', async () => {
    const user = userEvent.setup();
    stubApi(reads(review(), declared(review().id)));
    openConsole(PATH);
    await heading();

    await user.click(within(panel()).getByRole('button', { name: 'Declare a conflict' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Declare a conflict' }),
    );

    expect(await screen.findByText(/You declared a conflict/)).toBeTruthy();
  });

  it('keeps the review when the reviewer changes their mind', async () => {
    const user = userEvent.setup();
    const sent = stubApi(reads());
    openConsole(PATH);
    await heading();

    await user.click(within(panel()).getByRole('button', { name: 'Declare a conflict' }));
    await user.click(screen.getByRole('button', { name: 'Keep reviewing' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.some(({ key }) => key === api.conflict(started.id))).toBe(false);
  });

  it('says why the API refused, in the dialog', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(started, {
        [api.conflict(started.id)]: problem(
          409,
          'You have submitted this review, so you cannot declare a conflict now.',
        ),
      }),
    );
    openConsole(PATH);
    await heading();

    await user.click(within(panel()).getByRole('button', { name: 'Declare a conflict' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Declare a conflict' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'cannot declare a conflict now',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('a review that is not there', () => {
  it('says it is not on the reviewer’s list when the API answers 404', async () => {
    stubApi({
      ...reviewer(),
      [api.review(uuid(999))]: problem(404, 'There is no review with this address.'),
    });
    openConsole(`/northfield/reviews/${uuid(999)}`);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'This review is not on your list' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to My reviews' })).toBeTruthy();
  });

  it('says why it did not load and offers another go', async () => {
    const user = userEvent.setup();
    let reads = 0;
    stubApi({
      ...reviewer(),
      [api.review(started.id)]: () => {
        reads += 1;
        return reads === 1
          ? problem(503, 'The service is busy. Try again in a minute.')
          : ok(started);
      },
    });
    openConsole(PATH);

    expect(await screen.findByText('The service is busy. Try again in a minute.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await heading();
  });

  it('shows page not found for an address that is not a real id', async () => {
    stubApi({ ...reviewer() });
    openConsole('/northfield/reviews/mine');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});

describe('the keyboard shortcuts', () => {
  it('lists them from a button and from ? when no field has focus', async () => {
    const user = userEvent.setup();
    stubApi(reads());
    openConsole(PATH);
    await heading();

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Go to the next criterion')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.type(comment('Need'), '?');
    expect(screen.queryByRole('dialog')).toBeNull();
    score('Need', 4).focus();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});
