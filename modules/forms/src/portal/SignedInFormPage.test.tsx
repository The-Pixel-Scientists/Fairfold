// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  myResponsePageSchema,
  myResponseSchema,
  portalDraftSchema,
  portalFormSchema,
  portalReceiptSchema,
} from '../contracts/index.ts';
import { RESPONSES_PATH, RESPONSE_PATH, SIGNED_IN_FORM_PATH } from './paths.ts';
import { definition, fakeHost, FORM_ID, pageAt, RESPONSE_ID, VERSION_ID } from './testing.tsx';
import type { Sent } from './testing.tsx';

const FORM = 'GET /portal/forms/:formId';
const DRAFT = 'GET /portal/forms/:formId/draft';
const SAVE = 'PUT /portal/forms/:formId/draft';
const SUBMIT = 'POST /portal/forms/:formId/responses';
const NOW = '2027-01-05T10:00:00.000Z';

const form = portalFormSchema.parse({
  id: FORM_ID,
  title: 'Funder A survey',
  description: '',
  closesAt: null,
  formVersionId: VERSION_ID,
  definition,
});
const noDraft = portalDraftSchema.parse({ formVersionId: null, answers: {}, updatedAt: null });
const receipt = portalReceiptSchema.parse({
  responseId: RESPONSE_ID,
  submittedAt: NOW,
  confirmationMessage: '',
});
configure({ asyncUtilTimeout: 5000 });

const loadSignedInForm = () => import('./SignedInFormPage.tsx');
const loadMyResponses = () => import('./MyResponsesPage.tsx');
const loadMyResponse = () => import('./MyResponsePage.tsx');
const route = { path: SIGNED_IN_FORM_PATH, title: 'Answer a form', load: loadSignedInForm };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function open(draft = noDraft, submit: () => unknown = () => receipt) {
  const { host, sent } = fakeHost({
    [FORM]: () => form,
    [DRAFT]: () => draft,
    [SAVE]: () => draft,
    [SUBMIT]: submit,
  });
  render(pageAt(host, route, `/your-forms/${FORM_ID}`));
  return sent;
}

interface SaveInput {
  body: { answers: object };
}

const count = (sent: Sent[], key: string) => sent.filter((request) => request.key === key);

describe('a form for people who sign in', () => {
  it('saves the draft as the person moves on, and says so', async () => {
    const user = userEvent.setup();
    const sent = open();
    await user.click(await screen.findByRole('button', { name: 'Start' }));

    await user.type(await screen.findByLabelText(/Your name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { level: 1, name: 'Anything else' });
    const [save] = count(sent, SAVE);
    expect(save?.input).toEqual({
      params: { formId: FORM_ID },
      body: { formVersionId: VERSION_ID, answers: { f_name: 'Sam' } },
    });
    expect(screen.getByText(/Saved at/)).toBeTruthy();
    expect(
      screen.getByText('We save your answers as you type. You can leave at any time.'),
    ).toBeTruthy();
  });

  it('holds back an answer the engine refuses, instead of failing the save', async () => {
    const user = userEvent.setup();
    const sent = open();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.type(await screen.findByLabelText(/Your name/), 'Sam');
    fireEvent.change(screen.getByLabelText(/Your town/), { target: { value: 'x'.repeat(600) } });

    await waitFor(() => {
      expect(count(sent, SAVE).length).toBeGreaterThan(0);
    });
    const saves = count(sent, SAVE).map((request) => (request.input as SaveInput).body.answers);
    expect(saves.at(-1)).toEqual({ f_name: 'Sam' });
    expect(
      await screen.findByText('Some answers are not saved yet. Fix them to save them.'),
    ).toBeTruthy();
  });

  it('opens on the answers already saved', async () => {
    const user = userEvent.setup();
    open(
      portalDraftSchema.parse({
        formVersionId: VERSION_ID,
        answers: { f_name: 'Sam' },
        updatedAt: NOW,
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Continue my answers' }));

    expect((await screen.findByLabelText<HTMLInputElement>(/Your name/)).value).toBe('Sam');
  });

  it('sends once when the button is pressed twice, and names no person or funder', async () => {
    const user = userEvent.setup();
    let release = () => undefined;
    const sent = open(
      portalDraftSchema.parse({
        formVersionId: VERSION_ID,
        answers: { f_name: 'Sam' },
        updatedAt: NOW,
      }),
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(receipt);
          };
        }),
    );
    await user.click(await screen.findByRole('button', { name: 'Continue my answers' }));
    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await user.click(await screen.findByRole('button', { name: 'Save and check your answers' }));
    const button = await screen.findByRole('button', { name: 'Send my answers' });

    await user.click(button);
    await user.click(button);
    release();

    await screen.findByRole('heading', { name: 'Your answers have been sent' });
    const [request] = count(sent, SUBMIT);
    expect(count(sent, SUBMIT)).toHaveLength(1);
    expect(request?.input).toEqual({
      params: { formId: FORM_ID },
      body: { formVersionId: VERSION_ID, answers: { f_name: 'Sam' } },
    });
  });

  it('shows the page-not-found page when the API says no', async () => {
    const { host } = fakeHost({
      [FORM]: () => {
        throw new ProblemError(404, 'Not found.');
      },
      [DRAFT]: () => {
        throw new ProblemError(404, 'Not found.');
      },
    });
    render(pageAt(host, route, `/your-forms/${FORM_ID}`));

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });

  it('keeps what was typed and says so when a save fails', async () => {
    const user = userEvent.setup();
    const { host } = fakeHost({
      [FORM]: () => form,
      [DRAFT]: () => noDraft,
      [SAVE]: () => {
        throw new ProblemError(0, 'No connection.');
      },
    });
    render(pageAt(host, route, `/your-forms/${FORM_ID}`));
    await user.click(await screen.findByRole('button', { name: 'Start' }));

    await user.type(await screen.findByLabelText(/Your name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(
      await screen.findByText(
        'We could not save your answers. Check your connection and try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Your name/).value).toBe('Sam');
  });
});

describe('the answers a person has sent', () => {
  const summary = {
    id: RESPONSE_ID,
    formId: FORM_ID,
    formTitle: 'Funder A survey',
    submittedAt: NOW,
  };

  it('lists them, newest first, with the date', async () => {
    const { host } = fakeHost({
      'GET /portal/form-responses': () =>
        myResponsePageSchema.parse({ responses: [summary], nextCursor: null }),
    });
    render(
      pageAt(
        host,
        { path: RESPONSES_PATH, title: 'Your answers', load: loadMyResponses },
        RESPONSES_PATH,
      ),
    );

    const link = await screen.findByRole('link', { name: 'Funder A survey' });
    expect(link.getAttribute('href')).toBe(`${RESPONSES_PATH}/${RESPONSE_ID}`);
    expect(screen.getByText('Sent on 5 January 2027')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    const { host } = fakeHost({
      'GET /portal/form-responses': () =>
        myResponsePageSchema.parse({ responses: [], nextCursor: null }),
    });
    render(
      pageAt(
        host,
        { path: RESPONSES_PATH, title: 'Your answers', load: loadMyResponses },
        RESPONSES_PATH,
      ),
    );

    expect(await screen.findByText('You have not sent any answers yet')).toBeTruthy();
  });

  it('reads one back with the answers as the server showed them', async () => {
    const { host } = fakeHost({
      'GET /portal/form-responses/:responseId': () =>
        myResponseSchema.parse({
          ...summary,
          formVersionId: VERSION_ID,
          definition,
          answers: { f_name: 'Sam' },
        }),
    });
    render(
      pageAt(
        host,
        { path: RESPONSE_PATH, title: 'Your answers', load: loadMyResponse },
        `${RESPONSES_PATH}/${RESPONSE_ID}`,
      ),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Funder A survey' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Sam')).toBeTruthy();
    });
    expect(screen.getByText('Your name')).toBeTruthy();
  });
});
