// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  form,
  formId,
  response,
  responseId,
  responseSummary,
  versionSummary,
} from '../fixtures.test.ts';
import { id, ok, openForms, problem, setUpFormsTests, stubApi } from '../harness.test.tsx';

setUpFormsTests();

const base = `/console/forms/${formId}`;
const totals = { received: 12, signedIn: 9, anonymous: 3, sentWithoutCheck: 1, spam: 2 };

const opening = {
  [`GET ${base}`]: ok(form),
  [`GET ${base}/versions`]: ok({ versions: [versionSummary(1)] }),
  [`GET ${base}/response-totals`]: ok(totals),
};

describe('the responses page', () => {
  it('lists responses with the version, how sent and state in words, and shows totals as counts', async () => {
    stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({
        responses: [
          responseSummary(),
          responseSummary({
            id: id(8),
            route: 'anonymous',
            personId: null,
            sentWithoutCheck: true,
            submittedAt: '2027-07-02T10:00:00Z',
          }),
        ],
        nextCursor: null,
      }),
    });
    openForms(`/forms/${formId}/responses`);

    const table = await screen.findByRole('table', { name: /responses, the newest first/i });
    expect(within(table).getByRole('link', { name: '2 March 2027 at 10am' })).toBeTruthy();
    expect(within(table).getByText('Anonymous')).toBeTruthy();
    expect(within(table).getByText('Sent without the browser check')).toBeTruthy();
    expect(within(table).getByText('2 July 2027 at 11am')).toBeTruthy();

    const counts = screen.getByRole('table', { name: /response totals/i });
    expect(within(counts).getByRole('row', { name: 'Received 12' })).toBeTruthy();
    expect(within(counts).getByRole('row', { name: 'Marked as spam 2' })).toBeTruthy();
  });

  it('filters by how sent and version, and sends UTC days, never putting them in the address', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({
        responses: [responseSummary()],
        nextCursor: null,
      }),
      [`GET ${base}/responses?*`]: ok({ responses: [], nextCursor: null }),
      [`GET ${base}/response-totals?*`]: ok(totals),
    });
    openForms(`/forms/${formId}/responses`);

    await user.selectOptions(await screen.findByLabelText('How sent'), 'anonymous');
    await user.selectOptions(screen.getByLabelText('Version'), 'Version 1');
    await user.type(screen.getByLabelText('From'), '2027-07-01');

    expect(await screen.findByRole('heading', { name: 'No responses to show' })).toBeTruthy();
    expect(
      sent.some(({ key }) =>
        decodeURIComponent(key).includes('submittedFrom=2027-06-30T23:00:00Z'),
      ),
    ).toBe(true);
    expect(window.location.search).toBe('');
  });

  it('shows a page at a time', async () => {
    const user = userEvent.setup();
    stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({
        responses: [responseSummary()],
        nextCursor: 'p2',
      }),
      [`GET ${base}/responses?view=received&cursor=p2`]: ok({
        responses: [responseSummary({ id: id(8), submittedAt: '2027-03-01T10:00:00Z' })],
        nextCursor: null,
      }),
    });
    openForms(`/forms/${formId}/responses`);

    await user.click(await screen.findByRole('button', { name: 'Show more responses' }));
    expect(await screen.findByRole('link', { name: '1 March 2027 at 10am' })).toBeTruthy();
  });

  it('asks for the next page once however often the button is pressed, and says what happened', async () => {
    const sent = stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({
        responses: [responseSummary()],
        nextCursor: 'p2',
      }),
      [`GET ${base}/responses?view=received&cursor=p2`]: ok({
        responses: [responseSummary({ id: id(8), submittedAt: '2027-03-01T10:00:00Z' })],
        nextCursor: null,
      }),
    });
    openForms(`/forms/${formId}/responses`);

    const button = await screen.findByRole('button', { name: 'Show more responses' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText('Loading more responses').getAttribute('role')).toBe('status');

    expect(await screen.findByText('More responses loaded. Showing 2 in all.')).toBeTruthy();
    expect(sent.filter(({ key }) => key.includes('cursor=p2'))).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: '1 March 2027 at 10am' })).toHaveLength(1);
  });

  it('puts the list back as it was left when the member comes back to it', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({
        responses: [responseSummary()],
        nextCursor: null,
      }),
      [`GET ${base}/responses?view=spam`]: ok({ responses: [], nextCursor: null }),
      [`GET ${base}/response-totals`]: ok(totals),
    });
    const { unmount } = openForms(`/forms/${formId}/responses`);
    await user.selectOptions(await screen.findByLabelText('Show'), 'spam');
    await screen.findByRole('heading', { name: 'No responses to show' });
    unmount();

    sent.length = 0;
    openForms(`/forms/${formId}/responses`);
    expect(await screen.findByRole('heading', { name: 'No responses to show' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Show').value).toBe('spam');
    expect(sent.some(({ key }) => key.includes('/responses?'))).toBe(false);
  });

  it('says what to do when nothing matches', async () => {
    stubApi({
      ...opening,
      [`GET ${base}/responses?view=received`]: ok({ responses: [], nextCursor: null }),
    });
    openForms(`/forms/${formId}/responses`);

    expect(await screen.findByRole('heading', { name: 'No responses to show' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });
});

describe('reading one response', () => {
  const key = `GET /console/form-responses/${responseId}`;

  it("shows only the answers the server's projection returns, by the pinned version's questions", async () => {
    stubApi({ [key]: ok(response()) });
    openForms(`/forms/${formId}/responses/${responseId}`);

    expect(await screen.findByText('Did the session help?')).toBeTruthy();
    expect(screen.getByText('The volunteers were kind.')).toBeTruthy();
    expect(screen.queryByText('Do you have a long-term health condition?')).toBeNull();
    expect(screen.queryByText(/respondent|token|proof|client/i)).toBeNull();
    expect(screen.getByText(/Received 2 March 2027 at 10am, on version 1/)).toBeTruthy();
  });

  it('marks a response as spam only with a reason, says it is kept, and offers no delete', async () => {
    const user = userEvent.setup();
    const sent = stubApi({
      [key]: ok(response()),
      [`POST /console/form-responses/${responseId}/spam`]: ok(
        responseSummary({ spamReason: 'duplicate' }),
      ),
    });
    openForms(`/forms/${formId}/responses/${responseId}`);

    await user.click(await screen.findByRole('button', { name: 'Mark as spam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark this response as spam?' });
    expect(within(dialog).getByText(/The response is kept/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Mark as spam' }));
    expect(await within(dialog).findByText('Choose why this response is spam.')).toBeTruthy();
    expect(sent.some(({ key: sentKey }) => sentKey.endsWith('/spam'))).toBe(false);

    await user.click(within(dialog).getByLabelText('A duplicate'));
    await user.click(within(dialog).getByRole('button', { name: 'Mark as spam' }));

    expect(await screen.findByText('Spam: A duplicate')).toBeTruthy();
    expect(sent.find(({ key: sentKey }) => sentKey.endsWith('/spam'))?.body).toEqual({
      reason: 'duplicate',
    });
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark as not spam' })).toBeTruthy();
  });

  it('shows no marking to a member who may only read', async () => {
    stubApi({ [key]: ok(response()) });
    openForms(`/forms/${formId}/responses/${responseId}`, ['forms.responses.read']);

    await screen.findByText('Did the session help?');
    expect(screen.queryByRole('button', { name: 'Mark as spam' })).toBeNull();
  });

  it('shows the not-found page for a response in another funder', async () => {
    stubApi({ [key]: problem(404, 'We could not find that.') });
    openForms(`/forms/${formId}/responses/${responseId}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });

  it('keeps answers, filters and respondent details out of the address and history', async () => {
    stubApi({ [key]: ok(response()) });
    openForms(`/forms/${formId}/responses/${responseId}`);
    await screen.findByText('The volunteers were kind.');

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(window.location.href).not.toContain('kind');
    expect(JSON.stringify(window.history.state)).not.toContain('kind');
    expect(window.location.href).not.toContain(id(55));
  });
});
