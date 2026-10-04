// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepUpDialog } from '@pixel-scientists/ui';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { consoleSession, problem, stubApi } from '../testing/api.ts';
import { confirmItsYou, stepUpFailed } from './stepUp.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STEP_UP = 'POST /auth/step-up';
const credentials = { password: 'correct horse battery', code: '123456' };

describe('confirmItsYou', () => {
  it('sends the password and code, and hands the new session on', async () => {
    const session = consoleSession();
    const sent = stubApi({ [STEP_UP]: { status: 200, body: session } });
    const setSession = vi.fn();

    await confirmItsYou(credentials, setSession);

    expect(sent).toEqual([{ key: STEP_UP, body: credentials }]);
    expect(setSession).toHaveBeenCalledWith(session);
  });

  it('gives one message however the password or code was refused', async () => {
    const setSession = vi.fn();
    for (const status of [401, 403]) {
      stubApi({ [STEP_UP]: problem(status, 'The code was already used.') });
      await expect(confirmItsYou(credentials, setSession)).rejects.toMatchObject({
        status,
        detail: stepUpFailed,
      });
    }
    expect(setSession).not.toHaveBeenCalled();
  });

  it('checks the code before sending anything', async () => {
    const sent = stubApi({});

    await expect(
      confirmItsYou({ password: 'correct horse battery', code: '12' }, vi.fn()),
    ).rejects.toMatchObject({
      status: 400,
      errors: [
        { field: 'body.code', message: 'Enter the 6-digit code from your authenticator app.' },
      ],
    });
    expect(sent).toEqual([]);
  });

  it('says how long to wait after too many attempts', async () => {
    stubApi({ [STEP_UP]: { ...problem(429, 'Slow down.'), headers: { 'retry-after': '20' } } });

    await expect(confirmItsYou(credentials, vi.fn())).rejects.toMatchObject({
      status: 429,
      detail: 'Too many attempts. Wait 20 seconds, then try again.',
    });
  });
});

describe('the step-up dialog with the step-up route', () => {
  it('confirms the person, keeps the new session, and closes', async () => {
    const user = userEvent.setup();
    const session = consoleSession();
    stubApi({ [STEP_UP]: { status: 200, body: session } });
    const setSession = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <StepUpDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={(entered) => confirmItsYou(entered, setSession)}
      />,
    );

    await user.type(await screen.findByLabelText('Password'), credentials.password);
    await user.type(screen.getByLabelText('Code from your authenticator app'), credentials.code);
    await user.click(screen.getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(setSession).toHaveBeenCalledWith(session);
  });

  it('shows the one message for a refusal, and stays open', async () => {
    const user = userEvent.setup();
    stubApi({ [STEP_UP]: problem(401, 'Wrong password.') });
    const onOpenChange = vi.fn();
    render(
      <StepUpDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={(entered) => confirmItsYou(entered, vi.fn())}
      />,
    );

    await user.type(await screen.findByLabelText('Password'), credentials.password);
    await user.type(screen.getByLabelText('Code from your authenticator app'), credentials.code);
    await user.click(screen.getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByRole('link', { name: stepUpFailed })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
