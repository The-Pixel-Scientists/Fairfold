// SPDX-License-Identifier: AGPL-3.0-or-later

import { defaultEmailTemplates } from '@pixel-scientists/grants/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, heading, manager, ok, programme, reads, templates } from './fixtures.ts';
import type { Handlers } from './fixtures.ts';

setUpConsoleTests();

const open = async (more: Handlers = {}) => {
  const sent = stubApi({ ...manager(), ...reads, ...more });
  openConsole(`/northfield/programmes/${programme.id}/emails`);
  await heading('Outcome emails');
  await screen.findAllByRole('textbox', { name: 'Subject' });
  return sent;
};

const panel = (name: string) => screen.getByRole('region', { name });
const subject = (name: string) =>
  within(panel(name)).getByRole<HTMLInputElement>('textbox', { name: 'Subject' });
const text = (name: string) =>
  within(panel(name)).getByRole<HTMLTextAreaElement>('textbox', { name: 'Text of the email' });

describe('the outcome emails', () => {
  it('shows one email for each outcome, with its version and the saved words', async () => {
    await open();

    expect(subject('Accepted email').value).toBe(defaultEmailTemplates.accepted.subject);
    expect(text('Waitlisted email').value).toBe(defaultEmailTemplates.waitlisted.body);
    expect(within(panel('Accepted email')).getByText(/Version 1\./)).toBeTruthy();
    expect(within(panel('Declined email')).getByText(/Version 2\./)).toBeTruthy();
    expect(screen.getByText(/Nothing is sent when you record a decision/)).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Community Spaces Fund' })).toBeTruthy();
  });

  it('lists the merge fields each email may use: the award amount only in the accepted email', async () => {
    await open();

    const names = (email: string) =>
      within(within(panel(email)).getByRole('group', { name: /Merge fields/ }))
        .getAllByRole('button')
        .map((button) => button.textContent);
    expect(names('Accepted email')).toEqual([
      "Applicant's first name",
      'Organisation name',
      'Programme title',
      'Round title',
      'Link to the applicant portal',
      'Amount awarded, like £25,000',
    ]);
    expect(names('Declined email')).not.toContain('Amount awarded, like £25,000');
    expect(names('Waitlisted email')).toHaveLength(5);
  });

  it('puts a merge field at the cursor in the box last used, and keeps the cursor after it', async () => {
    const user = userEvent.setup();
    await open();
    const body = text('Declined email');
    body.focus();
    body.setSelectionRange(5, 5);
    const before = body.value;

    await user.click(
      within(panel('Declined email')).getByRole('button', { name: "Applicant's first name" }),
    );

    expect(body.value).toBe(`${before.slice(0, 5)}{{given_name}}${before.slice(5)}`);
    await waitFor(() => {
      expect(document.activeElement).toBe(body);
    });
    expect(body.selectionStart).toBe(5 + '{{given_name}}'.length);
    expect(screen.getByText("Applicant's first name added to the body")).toBeTruthy();

    const subjectBox = subject('Declined email');
    await user.click(subjectBox);
    subjectBox.setSelectionRange(0, 0);
    await user.click(within(panel('Declined email')).getByRole('button', { name: 'Round title' }));

    expect(subjectBox.value.startsWith('{{round_title}}')).toBe(true);
    expect(screen.getByText('Round title added to the subject')).toBeTruthy();
  });

  it('saves the three emails and shows the new versions', async () => {
    const user = userEvent.setup();
    const sent = await open({
      [api.setEmails]: (body) => {
        const sentEmails = body as typeof defaultEmailTemplates;
        return ok({
          accepted: { ...sentEmails.accepted, version: 2 },
          waitlisted: { ...sentEmails.waitlisted, version: 1 },
          declined: { ...sentEmails.declined, version: 2 },
        });
      },
    });
    await user.clear(subject('Accepted email'));
    await user.type(subject('Accepted email'), 'Good news about {{{{programme_title}}');

    await user.click(screen.getByRole('button', { name: 'Save emails' }));

    expect(await screen.findByText('Emails saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === api.setEmails)?.body).toEqual({
      accepted: {
        subject: 'Good news about {{programme_title}}',
        body: templates.accepted.body,
      },
      waitlisted: { subject: templates.waitlisted.subject, body: templates.waitlisted.body },
      declined: { subject: templates.declined.subject, body: templates.declined.body },
    });
    expect(within(panel('Accepted email')).getByText(/Version 2\./)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Back to programme' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses a merge field the email may not use, with the contract words beside its box', async () => {
    const user = userEvent.setup();
    const sent = await open();
    await user.type(text('Declined email'), ' {{{{award_amount}}');

    await user.click(screen.getByRole('button', { name: 'Save emails' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link').textContent).toBe(
      'Use only the merge fields listed for this email, written like {{given_name}}.',
    );
    expect(within(summary).getByRole('link').getAttribute('href')).toBe('#declined-body');
    expect(text('Declined email').getAttribute('aria-invalid')).toBe('true');
    expect(text('Accepted email').getAttribute('aria-invalid')).toBeNull();
    expect(sent.map(({ key }) => key)).not.toContain(api.setEmails);
  });

  it('says what an empty subject or text needs', async () => {
    const user = userEvent.setup();
    await open();
    await user.clear(subject('Waitlisted email'));
    await user.clear(text('Accepted email'));

    await user.click(screen.getByRole('button', { name: 'Save emails' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Enter the text of the email.', 'Enter a subject for the email.']);
  });

  it("shows the API's refusal beside the email it names", async () => {
    const user = userEvent.setup();
    await open({
      [api.setEmails]: problem(
        400,
        'Some fields are not valid. Fix the fields listed and try again.',
        [{ field: 'body.accepted.subject', message: 'Shorten the subject.' }],
      ),
    });
    await user.type(subject('Accepted email'), '!');

    await user.click(screen.getByRole('button', { name: 'Save emails' }));

    expect(await screen.findAllByText('Shorten the subject.')).toHaveLength(2);
    expect(subject('Accepted email').getAttribute('aria-invalid')).toBe('true');
  });

  it('asks before leaving with changes that are not saved', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(subject('Declined email'), '!');

    await user.click(screen.getByRole('link', { name: 'Back to programme' }));

    expect(await screen.findByRole('dialog', { name: 'Leave this page?' })).toBeTruthy();
  });
});
