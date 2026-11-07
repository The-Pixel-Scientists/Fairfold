// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A database error leaves the oldest-copy gauge unreported and logs a code,
// never the error's text.

import { createDatabase } from '@pixel-scientists/db';
import { describe, expect, it } from 'vitest';

import { captureLogs } from '../../../test/support.ts';
import { createLogger } from '../../logger.ts';
import { oldestPendingCopy } from './oldest.ts';

describe('the oldest pending audit copy', () => {
  it('is unreported, with a code logged, when the database fails', async () => {
    const auth = createDatabase<unknown>({
      host: '127.0.0.1',
      port: 1,
      database: 'unused',
      role: 'app_auth',
      password: 'unused-by-this-test-password',
      applicationName: 'tps-unit-tests',
    });
    await auth.destroy();
    const logs = captureLogs();
    const read = oldestPendingCopy(auth, createLogger({ level: 'info', destination: logs.stream }));

    expect(await read()).toBeUndefined();
    expect(logs.lines()).toEqual([
      expect.objectContaining({ level: 'error', code: 'audit_copy_age_unread' }),
    ]);
    expect(logs.text()).not.toMatch(/destroyed|ECONN|driver|stack/i);
  });
});
