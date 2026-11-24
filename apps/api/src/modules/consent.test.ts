// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes, randomUUID } from 'node:crypto';

import { partyPreferenceRoutes, partyPublicRoutes } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { Secret, type ModuleSettings } from '../config.ts';
import { signUnsubscribeToken, unsubscribeKeys } from '../email/unsubscribe-token.ts';
import { createLogger } from '../logger.ts';
import { composeModules, moduleDependencies } from '../modules.ts';
import { consentComposition } from './consent.ts';

const SECRET = 'a-test-secret-that-is-at-least-32-bytes';
const marketing: NonNullable<ModuleSettings['marketing']> = {
  suppression: { current: 1, versions: new Map([[1, new Secret(SECRET)]]) },
  unsubscribe: { current: 1, versions: new Map([[1, new Secret(SECRET)]]) },
};
const settings = (on: boolean): ModuleSettings => ({
  crm: undefined,
  marketing: on ? marketing : undefined,
  forms: undefined,
  assure: { registryKeys: {}, sanctionsListUrl: undefined },
});

const names = (on: boolean) =>
  (consentComposition(moduleDependencies({ settings: settings(on) })).routes ?? []).map(
    ({ contract }) => contract,
  );

describe('the consent composition', () => {
  it('serves the portal preference routes and, with marketing email set up, the unsubscribe routes', () => {
    expect(names(true)).toEqual([
      ...Object.values(partyPreferenceRoutes),
      ...Object.values(partyPublicRoutes),
    ]);
  });

  it('has no unsubscribe route when marketing email is not set up', () => {
    expect(names(false)).toEqual(Object.values(partyPreferenceRoutes));
  });

  it('keeps the path the email links to', () => {
    expect(partyPublicRoutes.getUnsubscribe.path).toBe('/public/unsubscribe');
    expect(partyPublicRoutes.confirmUnsubscribe.path).toBe('/public/unsubscribe');
  });

  it('supplies nothing else', () => {
    const { routes, ...rest } = consentComposition(moduleDependencies({}));

    expect(routes).toBeDefined();
    expect(rest).toEqual({});
  });
});

describe('the one-click POST through the built app', () => {
  const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

  async function api() {
    return buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      ...composeModules({
        publicTenants: {} as never,
        settings: settings(true),
      }),
    });
  }

  it('reads the form body, and answers a token that is not genuine with the same 404 as any other', async () => {
    const app = await api();
    const keys = unsubscribeKeys(new Map([[1, SECRET]]), 1);
    const target = {
      tenantId: randomUUID(),
      personId: randomUUID(),
      purpose: 'future_funding',
      channel: 'email',
      address: { hash: randomBytes(32), keyVersion: 1 },
    } as const;
    // A byte inside the ciphertext: the last character's padding bits would not change the bytes.
    const bytes = Buffer.from(signUnsubscribeToken(keys, target), 'base64url');
    bytes[20] = (bytes[20] ?? 0) ^ 1;
    const tampered = bytes.toString('base64url');
    const expired = signUnsubscribeToken(keys, target, new Date('2020-01-01T00:00:00Z'));
    const wrongKey = signUnsubscribeToken(
      unsubscribeKeys(new Map([[1, `other-${SECRET}`]]), 1),
      target,
    );

    for (const token of [tampered, expired, wrongKey]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/public/unsubscribe?token=${token}`,
        headers: FORM,
        payload: 'List-Unsubscribe=One-Click',
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(token);
    }
    await app.close();
  });
});
