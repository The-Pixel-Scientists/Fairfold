// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../logger.ts';
import { captureLogs } from '../../../test/support.ts';
import { ApiError } from '../../problems.ts';
import { checkNewPassword, recheckAtSignIn, type PasswordCheckDependencies } from './policy.ts';
import type { BreachAnswer } from './range.ts';

const PASSWORD = 'a long synthetic passphrase';
const COMMON = new Set(['synthetic common password']);

function deps(answer: BreachAnswer, breachCheck = true) {
  const logs = captureLogs();
  const lookUpPassword = vi.fn<(password: string) => Promise<BreachAnswer>>(() =>
    Promise.resolve(answer),
  );
  const checks: PasswordCheckDependencies = {
    settings: { breachCheck },
    lookUpPassword,
    log: createLogger({ level: 'info', destination: logs.stream }),
  };
  return { checks, lookUpPassword, logs };
}

async function refusal(work: Promise<unknown>): Promise<ApiError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ApiError)) throw new Error('The password was not refused.');
  return error;
}

describe('checkNewPassword', () => {
  it('refuses a common password before any lookup, even with the check off', async () => {
    for (const on of [true, false]) {
      const { checks, lookUpPassword } = deps({ answer: 'not_breached' }, on);
      const error = await refusal(
        checkNewPassword(checks, 'r1', COMMON, 'Synthetic Common Password'),
      );
      expect(error.reason).toBe('common_password');
      expect(lookUpPassword).not.toHaveBeenCalled();
    }
  });

  it('refuses a breached password without echoing it', async () => {
    const { checks } = deps({ answer: 'breached' });
    const error = await refusal(checkNewPassword(checks, 'r1', COMMON, PASSWORD));
    expect(error.status).toBe(400);
    expect(error.reason).toBe('breached_password');
    const text = JSON.stringify({ detail: error.detail, errors: error.errors });
    expect(text).toMatch(/appeared in a data breach/);
    expect(text).not.toContain(PASSWORD);
  });

  it('accepts a clear password with nothing pending', async () => {
    const { checks, lookUpPassword } = deps({ answer: 'not_breached' });
    expect(await checkNewPassword(checks, 'r1', COMMON, PASSWORD)).toBe(false);
    expect(lookUpPassword).toHaveBeenCalledWith(PASSWORD);
  });

  it('accepts a password with no answer as pending, logging the code alone', async () => {
    const { checks, logs } = deps({ answer: 'no_answer', code: 'timeout' });
    expect(await checkNewPassword(checks, 'r1', COMMON, PASSWORD)).toBe(true);
    expect(logs.lines()).toEqual([
      expect.objectContaining({ breachCheck: 'timeout', requestId: 'r1' }),
    ]);
    expect(logs.text()).not.toContain(PASSWORD);
  });

  it('makes no request and sets no flag when the check is off', async () => {
    const { checks, lookUpPassword } = deps({ answer: 'breached' }, false);
    expect(await checkNewPassword(checks, 'r1', COMMON, PASSWORD)).toBe(false);
    expect(await recheckAtSignIn(checks, 'r1', new Date(), PASSWORD)).toBeUndefined();
    expect(lookUpPassword).not.toHaveBeenCalled();
  });
});

describe('recheckAtSignIn', () => {
  it('looks up only an account whose check is pending', async () => {
    const { checks, lookUpPassword } = deps({ answer: 'breached' });
    expect(await recheckAtSignIn(checks, 'r1', null, PASSWORD)).toBeUndefined();
    expect(lookUpPassword).not.toHaveBeenCalled();
    expect(await recheckAtSignIn(checks, 'r1', new Date(), PASSWORD)).toBe('breached');
  });
});
