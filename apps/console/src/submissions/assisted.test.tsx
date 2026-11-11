// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { APPLICATION, assisted, complete, detail, manager, ok } from './fixtures.ts';

setUpConsoleTests();

const PATH = `/northfield/assisted-applications/${APPLICATION}`;
const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const api = {
  read: `GET /console/assisted-applications/${APPLICATION}`,
  save: `PUT /console/assisted-applications/${APPLICATION}/answers`,
  check: `POST /console/assisted-applications/${APPLICATION}/eligibility-check`,
  submit: `POST /console/assisted-applications/${APPLICATION}/submit`,
  stepUp: 'POST /auth/step-up',
} as const;

const reads = (answers?: Record<string, unknown>, extra = {}) => ({
  ...manager(),
  [api.read]: ok(assisted(answers)),
  [api.check]: ok({ status: 'eligible' }),
  ...extra,
});

const banner = () =>
  screen.findByText(
    'You are filling in this application for Harbourside Youth Project on behalf of Sam Patel. They will be told you submitted it.',
  );

describe('an application a member fills in for an applicant', () => {
  it('says whose application it is, once it has opened, on every step', async () => {
    const user = userEvent.setup();
    stubApi(reads());
    openConsole(PATH);

    expect((await banner()).getAttribute('role')).toBe('status');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Application for Harbourside Youth Project',
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Organisation name/)).toHaveProperty(
      'value',
      'Harbourside Youth Project',
    );

    await user.click(screen.getByRole('button', { name: 'Save and check answers' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Check before you submit' }),
    ).toBeTruthy();
    expect(await banner()).toBeTruthy();
  });

  it('keeps the draft: a save is based on the version it read and sends the answers typed', async () => {
    const user = userEvent.setup();
    const sent = stubApi(
      reads(complete, {
        [api.save]: {
          status: 200,
          body: { answersVersion: 5, updatedAt: '2026-10-30T09:05:00.000Z' },
        },
      }),
    );
    openConsole(PATH);
    const name = await screen.findByLabelText(/Organisation name/);
    await user.clear(name);
    await user.type(name, 'Harbourside Youth Club');
    expect(screen.getByText('You have changes that are not saved.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save answers' }));

    await waitFor(() => {
      expect(screen.getByText('Everything is saved. You can leave and come back.')).toBeTruthy();
    });
    const [request] = sent.filter(({ key }) => key === api.save);
    expect(request?.body).toEqual({
      basedOn: 4,
      answers: { ...complete, f_name: 'Harbourside Youth Club' },
    });
  });

  it('lists what is still missing before it can be submitted, and goes back to the question', async () => {
    const user = userEvent.setup();
    stubApi(reads({ f_name: 'Harbourside Youth Project', f_charity: true, f_number: '1234567' }));
    openConsole(PATH);
    await user.click(await screen.findByRole('button', { name: 'Save and check answers' }));

    const heading = await screen.findByRole('heading', { level: 3, name: 'Still to answer' });
    const list = heading.nextElementSibling as HTMLElement;
    expect(within(list).getByText('What will you do with the money?.')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Submit application for Harbourside Youth Project' })
        .getAttribute('aria-disabled'),
    ).toBe('true');

    await user.click(
      within(list).getAllByRole('button', { name: 'Go to question' })[0] as HTMLElement,
    );
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('f_story');
    });
  });

  it('submits after the member confirms it is them, sending only the version, then opens the submission', async () => {
    const user = userEvent.setup();
    let submits = 0;
    const sent = stubApi(
      reads(complete, {
        [api.submit]: () => {
          submits += 1;
          return submits === 1
            ? problem(403, STEP_UP_NEEDED)
            : ok(detail({ id: APPLICATION, submissionRoute: 'assisted' }));
        },
        [api.stepUp]: ok(consoleSession()),
      }),
    );
    openConsole(PATH);
    await user.click(await screen.findByRole('button', { name: 'Save and check answers' }));
    expect(await screen.findByText('Eligible')).toBeTruthy();
    expect(screen.getByText('Every question that needs an answer has one.')).toBeTruthy();
    expect(screen.getByText('5 of 5 questions')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Submit application for Harbourside Youth Project' }),
    );
    const step = within(await screen.findByRole('dialog', { name: 'Confirm it is you' }));
    await user.type(step.getByLabelText('Password'), 'correct horse battery');
    await user.type(step.getByLabelText(/Code from your authenticator app/), '123456');
    await user.click(step.getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/northfield/submissions/${APPLICATION}`);
    });
    expect(sent.filter(({ key }) => key === api.submit).map(({ body }) => body)).toEqual([
      { basedOn: 4 },
      { basedOn: 4 },
    ]);
  });

  it('puts the member back on the questions the server refused, with a summary that links to them', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(complete, {
        [api.submit]: problem(400, 'Check the highlighted answers.', [
          { field: 'body.answers.f_number', message: 'Enter a charity number with 6 or 7 digits.' },
        ]),
      }),
    );
    openConsole(PATH);
    await user.click(await screen.findByRole('button', { name: 'Save and check answers' }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Submit application for Harbourside Youth Project',
      }),
    );

    expect(await screen.findByText('Check the highlighted answers.')).toBeTruthy();
    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(
      within(summary).getByRole('link', { name: 'Enter a charity number with 6 or 7 digits.' }),
    ).toBeTruthy();
  });

  it('moves focus to the first section when the member goes back to the answers', async () => {
    const user = userEvent.setup();
    stubApi(reads(complete));
    openConsole(PATH);
    await user.click(await screen.findByRole('button', { name: 'Save and check answers' }));
    await user.click(await screen.findByRole('button', { name: 'Back to answers' }));

    const first = (await screen.findAllByRole('heading', { level: 2 }))[0];
    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });

  it('stops an ineligible application from being submitted and says why', async () => {
    const user = userEvent.setup();
    stubApi(
      reads(complete, {
        [api.check]: ok({
          status: 'stopped',
          fieldId: 'f_charity',
          explanation: 'We only fund registered charities.',
        }),
      }),
    );
    openConsole(PATH);
    await user.click(await screen.findByRole('button', { name: 'Save and check answers' }));

    expect(await screen.findByText('We only fund registered charities.')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Submit application for Harbourside Youth Project' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('is not offered to a member who cannot submit for applicants', async () => {
    const session = consoleSession({ roles: ['reviewer'] });
    stubApi({ 'GET /auth/session': ok(session) });
    openConsole(PATH);
    expect(await screen.findByText('You cannot submit for applicants')).toBeTruthy();
  });
});
