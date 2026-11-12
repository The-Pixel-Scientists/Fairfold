// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The optional equality monitoring step: offered only after an application is
// sent, skippable on every screen, answered with separate consent, withdrawn
// on request, and never kept on the device or in an address.

import { monitoringResponseSchema, monitoringTemplate } from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubApi } from '../testing/api.ts';
import { APPLICATION_ID, application, applicationServer } from '../testing/apply.ts';
import { monitoringForm, monitoringServer, noMonitoring } from '../testing/monitoring.ts';
import type { MonitoringServer } from '../testing/monitoring.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const submitted = application({ status: 'submitted', submittedAt: '2026-10-21T12:00:00.000Z' });
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const methods = (sent: { key: string }[]) =>
  sent.filter(({ key }) => key.includes('/monitoring')).map(({ key }) => key.split(' ')[0]);

function open(
  path: string,
  start: Application = submitted,
  monitoring: MonitoringServer = monitoringServer(),
) {
  const sent = stubApi({
    ...signedIn,
    ...applicationServer(start).handlers,
    ...monitoring.handlers,
  });
  openPortal(path);
  return { sent, monitoring };
}

/** Starts the questions and chooses "Prefer not to say" for the first. */
async function startAnswering(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Answer monitoring questions' }));
  const [first] = await screen.findAllByRole('radio', { name: 'Prefer not to say' });
  if (first === undefined) throw new Error('No question to answer.');
  await user.click(first);
}

describe('the offer', () => {
  it('shows on the confirmation page once the application is sent', async () => {
    open(`${home}/submitted`);

    expect(await screen.findByRole('link', { name: 'Answer monitoring questions' })).toHaveProperty(
      'pathname',
      `${home}/monitoring`,
    );
  });

  it('shows on the application page until answered', async () => {
    open(home);
    expect(await screen.findByRole('link', { name: 'Answer monitoring questions' })).toBeTruthy();
  });

  it('asks nothing about monitoring, and shows nothing, before the application is sent', async () => {
    const { sent } = open(`${home}/submitted`, application());

    expect(await screen.findByText('You have not sent this application yet.')).toBeTruthy();
    expect(screen.queryByText(/monitoring/i)).toBeNull();
    expect(methods(sent)).toEqual([]);
  });

  it('is left out when the round has no monitoring form', async () => {
    stubApi({ ...signedIn, ...applicationServer(submitted).handlers, ...noMonitoring });
    openPortal(`${home}/submitted`);

    expect(await screen.findByText('You do not need to do anything now.')).toBeTruthy();
    expect(screen.queryByText('Equality monitoring')).toBeNull();
  });
});

describe('the step', () => {
  it('explains, before any question, that the answers are optional and only counted', async () => {
    open(`${home}/monitoring`);

    expect(await h1('Equality monitoring')).toBeTruthy();
    expect(screen.getByText(/only use your answers to count totals/)).toBeTruthy();
    expect(screen.getByText(/never see them next to your application/)).toBeTruthy();
    expect(screen.getByText(/no effect on your application/)).toBeTruthy();
    expect(screen.getByText(/privacy notice version 1\.0/)).toBeTruthy();
    expect(within(screen.getByRole('main')).queryByRole('radio')).toBeNull();
  });

  it('skips from the first screen without sending anything', async () => {
    const user = userEvent.setup();
    const { sent } = open(`${home}/monitoring`);
    await h1('Equality monitoring');

    await user.click(screen.getByRole('link', { name: 'Skip these questions' }));

    expect(window.location.pathname).toBe(home);
    expect(methods(sent)).not.toContain('PUT');
    expect(methods(sent)).not.toContain('DELETE');
  });

  it('shows every question with Prefer not to say, and a skip on this screen too', async () => {
    const user = userEvent.setup();
    open(`${home}/monitoring`);
    await user.click(await screen.findByRole('button', { name: 'Answer monitoring questions' }));

    expect(await h1('Equality monitoring questions')).toBeTruthy();
    const questions = monitoringTemplate().sections.flatMap(({ fields }) => fields);
    expect(
      within(screen.getByRole('main')).getAllByRole('radio', { name: 'Prefer not to say' }),
    ).toHaveLength(questions.length);
    expect(screen.getByRole('link', { name: 'Skip these questions' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /I agree to my answers/ })).toHaveProperty(
      'checked',
      false,
    );
  });

  it('refuses to send without consent, then sends once with it', async () => {
    const user = userEvent.setup();
    const { sent, monitoring } = open(`${home}/monitoring`);
    await startAnswering(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));
    expect(
      await screen.findByRole('link', {
        name: 'Tick the box to agree to your answers being used for equality monitoring.',
      }),
    ).toBeTruthy();
    expect(monitoring.saved).toEqual([]);

    await user.click(screen.getByRole('checkbox', { name: /I agree to my answers/ }));
    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(document.activeElement).toBe(await h1('Your monitoring answers'));
    expect(screen.getByText('Thank you. We have your answers.')).toBeTruthy();
    expect(monitoring.saved).toEqual([
      {
        formVersionId: monitoringForm().formVersionId,
        answers: { f_agegroup: 'prefer_not_to_say' },
        consent: true,
        privacyNoticeVersion: '1.0',
      },
    ]);
    expect(methods(sent).filter((method) => method === 'PUT')).toHaveLength(1);
  });

  it('keeps no answer in storage, the address or the page title', async () => {
    const user = userEvent.setup();
    open(`${home}/monitoring`);
    await startAnswering(user);

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toMatch(/prefer|f_agegroup/i);
    expect(document.title).not.toMatch(/prefer/i);
    expect(screen.getByText(/We do not save them until you send them/)).toBeTruthy();
  });

  it('does not show questions that lack Prefer not to say, and does not add it', async () => {
    const definition = monitoringTemplate();
    const first = definition.sections[0]?.fields[0];
    if (first === undefined || !('options' in first))
      throw new Error('Expected a choice question.');
    first.options = first.options.filter(({ value }) => value !== 'prefer_not_to_say');
    open(`${home}/monitoring`, submitted, monitoringServer(monitoringForm(definition)));

    expect(await screen.findByText(/We cannot show these questions/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Answer monitoring questions' })).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('radio')).toBeNull();
  });
});

describe('the applicant’s own answers', () => {
  const mine = monitoringResponseSchema.parse({
    formVersionId: monitoringForm().formVersionId,
    answers: { f_agegroup: 'prefer_not_to_say' },
    privacyNoticeVersion: '1.0',
    consentGivenAt: '2026-10-21T14:14:00.000Z',
  });

  it('are shown, with the way to withdraw them', async () => {
    open(`${home}/monitoring`, submitted, monitoringServer(monitoringForm(), mine));

    expect(await h1('Your monitoring answers')).toBeTruthy();
    expect(screen.getByText(/21 October 2026 at 3:14pm, UK time/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw my answers' })).toBeTruthy();
  });

  it('are deleted on withdrawal, and the application does not change', async () => {
    const user = userEvent.setup();
    const { sent } = open(
      `${home}/monitoring`,
      submitted,
      monitoringServer(monitoringForm(), mine),
    );

    await user.click(await screen.findByRole('button', { name: 'Withdraw my answers' }));

    expect(document.activeElement).toBe(await h1('Your answers are deleted'));
    expect(
      screen.getByText(
        'We have deleted your monitoring answers. Your application has not changed.',
      ),
    ).toBeTruthy();
    expect(methods(sent).filter((method) => method === 'DELETE')).toHaveLength(1);
    expect(sent.some(({ key }) => key.includes('/withdraw'))).toBe(false);
  });
});
