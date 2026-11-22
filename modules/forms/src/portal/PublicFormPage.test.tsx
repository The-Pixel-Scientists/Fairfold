// SPDX-License-Identifier: AGPL-3.0-or-later

import { idempotencyProblems, ProblemError } from '@pixel-scientists/domain/api';
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  publicFormProblems,
  publicResponseInputSchema,
  respondentTokenSchema,
} from '../contracts/index.ts';
import { PUBLIC_FORM_PATH } from './paths.ts';
import { solveInWorker } from './proof.ts';
import { saveProgress } from './progress.ts';
import {
  challengeReply,
  fakeHost,
  FORM_ID,
  NEW_VERSION_ID,
  publicForm,
  pageAt,
  VERSION_ID,
} from './testing.tsx';
import type { Sent } from './testing.tsx';

vi.mock('./proof.ts', () => ({
  solveInWorker: vi.fn(() => Promise.resolve(Array.from({ length: 16 }, (_, index) => index))),
}));

const FORM = `GET /public/tenants/:slug/forms/:formId`;
const CHALLENGE = `GET /public/tenants/:slug/forms/:formId/challenge`;
const SUBMIT = `POST /public/tenants/:slug/forms/:formId/responses`;
configure({ asyncUtilTimeout: 5000 });

const loadPublicForm = () => import('./PublicFormPage.tsx');
const route = {
  path: PUBLIC_FORM_PATH,
  title: 'Answer a form',
  load: loadPublicForm,
};
const address = `/forms/${FORM_ID}`;
const receipt = { responseId: FORM_ID, confirmationMessage: 'Thanks from Funder A.' };

/** A proof is made, and a response refused with a problem or accepted. */
function setUp(submit: (input: unknown) => unknown = () => receipt, forms = [publicForm()]) {
  let reads = 0;
  const { host, sent } = fakeHost({
    [FORM]: () => forms[Math.min(reads++, forms.length - 1)],
    [CHALLENGE]: challengeReply,
    [SUBMIT]: submit,
  });
  render(pageAt(host, route, address));
  return sent;
}

const keys = () => Object.keys(window.localStorage);
const submits = (sent: Sent[]) => sent.filter(({ key }) => key === SUBMIT);

async function toReview(user: UserEvent, name = 'Sam') {
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  await user.type(await screen.findByLabelText(/Your name/), name);
  await user.click(screen.getByRole('button', { name: 'Save and continue' }));
  await user.click(await screen.findByRole('button', { name: 'Save and check your answers' }));
  await screen.findByRole('heading', { level: 1, name: 'Check your answers' });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(solveInWorker).mockImplementation(() =>
    Promise.resolve(Array.from({ length: 16 }, (_, index) => index)),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('the public form page', () => {
  it('says answers are kept on this device before the first question', async () => {
    const sent = setUp();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Funder A feedback' }),
    ).toBeTruthy();
    expect(screen.getByText(/saved on this device until you send them/)).toBeTruthy();
    expect(screen.getByText(/select Clear my answers when you finish/)).toBeTruthy();
    expect(screen.queryByLabelText(/Your name/)).toBeNull();
    expect(sent.every(({ options }) => options?.anonymous === true)).toBe(true);
  });

  it('keeps answers on this device only, and restores them with the notice', async () => {
    const user = userEvent.setup();
    const sent = setUp();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.type(await screen.findByLabelText(/Your name/), 'Sam');

    expect(keys()).toEqual([`form-progress:${FORM_ID}:${VERSION_ID}`]);
    expect(sent.some(({ key }) => key === SUBMIT)).toBe(false);

    cleanup();
    setUp();
    expect(await screen.findByText('We found the answers you saved earlier.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue my answers' }));
    expect((await screen.findByLabelText<HTMLInputElement>(/Your name/)).value).toBe('Sam');
  });

  it('clears the answers only after the person confirms', async () => {
    const user = userEvent.setup();
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' });
    setUp();

    await user.click(await screen.findByRole('button', { name: 'Clear my answers' }));
    await user.click(await screen.findByRole('button', { name: 'Keep my answers' }));
    expect(keys()).toHaveLength(1);

    await user.click(await screen.findByRole('button', { name: 'Clear my answers' }));
    await user.click(
      await screen.findByRole('button', { name: 'Clear my answers', hidden: false }),
    );
    await waitFor(() => {
      expect(keys()).toEqual([]);
    });
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('keeps the answers it can when the form has changed since the last visit', async () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam', f_gone: 'x' });
    window.localStorage.setItem(
      `form-progress:${FORM_ID}:${VERSION_ID}`,
      JSON.stringify({ answers: { f_name: 'Sam', f_gone: 'x' } }),
    );
    setUp(() => receipt, [publicForm(NEW_VERSION_ID)]);

    expect(await screen.findByText(/This form has changed since you started/)).toBeTruthy();
    expect(keys()).toEqual([`form-progress:${FORM_ID}:${NEW_VERSION_ID}`]);
  });

  it('shows one not-found page, and drops what was kept, whatever the reason', async () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' });
    const { host } = fakeHost({
      [FORM]: () => {
        throw new ProblemError(404, 'Not found.');
      },
    });
    render(pageAt(host, route, address));

    expect(await screen.findByRole('heading', { name: 'We cannot find this form' })).toBeTruthy();
    expect(keys()).toEqual([]);
  });

  it('works, and says answers are not kept, when the browser keeps nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    setUp();

    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.type(await screen.findByLabelText(/Your name/), 'S');

    expect(
      await screen.findByText(/Not saved. If you close this page, you will lose/),
    ).toBeTruthy();
  });

  it('says answers are kept for this website only in a frame', async () => {
    const { host } = fakeHost({ [FORM]: () => publicForm(), [CHALLENGE]: challengeReply }, true);
    render(pageAt(host, route, address));

    expect(await screen.findByText(/saved on this device for this website only/)).toBeTruthy();
  });
});

describe('sending the answers', () => {
  it('sends once, with the token in the body and nothing that names a person or funder', async () => {
    const user = userEvent.setup();
    const sent = setUp();
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(
      await screen.findByRole('heading', { name: 'Your answers have been sent' }),
    ).toBeTruthy();
    expect(screen.getByText('Thanks from Funder A.')).toBeTruthy();
    const [request] = submits(sent);
    const { params, body } = request?.input as {
      params: object;
      body: { respondentToken: string; answers: object };
    };
    expect(params).toEqual({ slug: 'tenant-a', formId: FORM_ID });
    expect(Object.keys(body).sort()).toEqual([
      'answers',
      'formVersionId',
      'proof',
      'respondentToken',
    ]);
    expect(body.answers).toEqual({ f_name: 'Sam' });
    expect(respondentTokenSchema.safeParse(body.respondentToken).success).toBe(true);
    expect(publicResponseInputSchema.safeParse(body).success).toBe(true);
    expect(request?.options?.anonymous).toBe(true);
    expect(screen.getByText(body.respondentToken)).toBeTruthy();
    expect(keys()).toEqual([]);
    expect(document.body.textContent).not.toContain('Sam');
  });

  it('sends once when the button is pressed twice', async () => {
    const user = userEvent.setup();
    let release = () => undefined;
    const sent = setUp(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(receipt);
          };
        }),
    );
    await toReview(user);

    const button = screen.getByRole('button', { name: 'Send my answers' });
    await user.click(button);
    await user.click(button);
    await act(async () => {
      release();
      await Promise.resolve();
    });

    await screen.findByRole('heading', { name: 'Your answers have been sent' });
    expect(submits(sent)).toHaveLength(1);
  });

  it('announces the browser check politely while the person waits for it', async () => {
    const user = userEvent.setup();
    vi.mocked(solveInWorker).mockReturnValue(new Promise(() => undefined));
    setUp();
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    const status = await screen.findByText(
      'Checking your answers before sending. This can take a few seconds.',
    );
    expect(status.getAttribute('role')).toBe('status');
  });

  it('sends without the check when it is too slow and the form allows that', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(solveInWorker).mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sent = setUp();
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await screen.findByRole('heading', { name: 'Your answers have been sent' });
    expect((submits(sent)[0]?.input as { body: { proof: unknown } }).body.proof).toBeNull();
  });

  it('asks for a new check once when the first is refused, then shows the words and Try again', async () => {
    const user = userEvent.setup();
    const sent = setUp(() => {
      throw new ProblemError(400, 'x');
    });
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(await screen.findByText(publicFormProblems.proofInvalid.detail)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(submits(sent)).toHaveLength(2);
    expect(sent.filter(({ key }) => key === CHALLENGE).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the answers and shows the wait the API gave on a 429', async () => {
    const user = userEvent.setup();
    setUp(() => {
      throw new ProblemError(429, 'Too many attempts. Wait 30 seconds, then try again.');
    });
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(await screen.findByText(/Wait 30 seconds/)).toBeTruthy();
    expect(keys()).toHaveLength(1);
  });

  it('keeps the answers and shows the catalogue words on a key conflict', async () => {
    const user = userEvent.setup();
    setUp(() => {
      throw new ProblemError(409, idempotencyProblems.reused.detail, {
        type: idempotencyProblems.reused.type,
        idempotencyKey: '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90', // gitleaks:allow
      });
    });
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(await screen.findByText(idempotencyProblems.reused.detail)).toBeTruthy();
    expect(keys()).toHaveLength(1);
  });

  it('retries a lost connection with the same key and token, and a new check', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const sent = setUp(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProblemError(0, 'No connection.', {
          idempotencyKey: '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90', // gitleaks:allow
        });
      }
      return receipt;
    });
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await screen.findByRole('heading', { name: 'Your answers have been sent' });
    const [first, second] = submits(sent);
    expect(second?.options?.idempotencyKey).toBe('0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90');
    expect((second?.input as { body: { respondentToken: string } }).body.respondentToken).toBe(
      (first?.input as { body: { respondentToken: string } }).body.respondentToken,
    );
  });

  it('reads the form again when it changed, keeps the answers it still asks and asks for a check', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    setUp(() => {
      attempts += 1;
      if (attempts === 1) throw new ProblemError(409, 'Request failed.');
      return receipt;
    }, [publicForm(), publicForm(NEW_VERSION_ID)]);
    await toReview(user);

    await user.click(screen.getByRole('button', { name: 'Send my answers' }));

    expect(await screen.findByText(/This form changed while you were answering/)).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(keys()).toEqual([`form-progress:${FORM_ID}:${NEW_VERSION_ID}`]);
  });

  it('lists a required question that is not answered, with a way to go to it', async () => {
    const user = userEvent.setup();
    const sent = setUp();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await user.click(await screen.findByRole('button', { name: 'Save and check your answers' }));

    await user.click(await screen.findByRole('button', { name: 'Send my answers' }));

    expect(await screen.findByText('One question needs your attention')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go to this question' }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('f_name');
    });
    expect(submits(sent)).toHaveLength(0);
  });
});
