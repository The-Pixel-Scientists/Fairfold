// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { checkedAddress, serverName } from './connect.ts';

describe('the connect path', () => {
  it('resolves once and returns the address it checked', async () => {
    const resolve = vi.fn(() => Promise.resolve(['93.184.216.34', '2606:2800:220:1::']));

    expect(await checkedAddress('example.test', resolve)).toBe('93.184.216.34');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('example.test');
  });

  it('refuses when any resolved address is refused, whatever its order', async () => {
    for (const addresses of [
      ['93.184.216.34', '10.0.0.5'],
      ['10.0.0.5', '93.184.216.34'],
      ['2606:2800:220:1::', '::1'],
    ]) {
      await expect(
        checkedAddress('example.test', () => Promise.resolve(addresses)),
      ).rejects.toMatchObject({
        code: 'address_refused',
      });
    }
  });

  it('refuses a host that resolves to nothing', async () => {
    await expect(checkedAddress('example.test', () => Promise.resolve([]))).rejects.toMatchObject({
      code: 'address_refused',
    });
  });

  it('reports a failed lookup without the host name or the resolver error', async () => {
    const failure = checkedAddress('secret-host.test', () =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND secret-host.test')),
    );

    await expect(failure).rejects.toMatchObject({ code: 'unresolvable' });
    await expect(failure).rejects.toSatisfy(
      (error: Error) => !error.message.includes('secret-host') && error.cause === undefined,
    );
  });

  it('checks an IPv6 literal given in brackets', async () => {
    await expect(checkedAddress('[::1]', (host) => Promise.resolve([host]))).rejects.toMatchObject({
      code: 'address_refused',
    });
  });

  it('gives a server name for a host name and none for an IP literal', () => {
    expect(serverName('example.test')).toBe('example.test');
    expect(serverName('93.184.216.34')).toBeUndefined();
    expect(serverName('[2606:2800:220:1::]')).toBeUndefined();
  });
});
