// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { recordBreachSetting } from './breach-setting.ts';

describe('recording the breached-password check setting at start-up', () => {
  it('records the setting and lets the API start', async () => {
    const auth = { recordBreachCheckSetting: vi.fn().mockResolvedValue(true) };
    const log = { fatal: vi.fn() };

    await expect(recordBreachSetting(auth, log)).resolves.toBe(true);
    expect(auth.recordBreachCheckSetting).toHaveBeenCalledOnce();
    expect(log.fatal).not.toHaveBeenCalled();
  });

  it('logs fatal and stops the start when it cannot be recorded', async () => {
    const error = new Error('connection refused');
    const auth = { recordBreachCheckSetting: vi.fn().mockRejectedValue(error) };
    const log = { fatal: vi.fn() };

    await expect(recordBreachSetting(auth, log)).resolves.toBe(false);
    expect(log.fatal).toHaveBeenCalledWith(
      { err: error },
      'The breached-password check setting could not be recorded',
    );
  });
});
