// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { proxyProblems } from './proxy.ts';

describe('the proxy check', () => {
  it.each(['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY'])(
    'names %s in either case, and not its value',
    (name) => {
      for (const variable of [name, name.toLowerCase()]) {
        const problems = proxyProblems({ [variable]: 'http://secret-7q@proxy.example.org' });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain(`${variable} is set.`);
        expect(problems[0]).not.toContain('secret-7q');
      }
    },
  );

  it('finds a variable set to an empty string, and reports each variable once', () => {
    expect(proxyProblems({ http_proxy: '', HTTPS_PROXY: '' })).toHaveLength(2);
  });

  it('finds nothing in an environment without them, and ignores NO_PROXY', () => {
    expect(proxyProblems({ PATH: '/usr/bin', NO_PROXY: '*', TPS_API_HOST: '127.0.0.1' })).toEqual(
      [],
    );
  });
});
