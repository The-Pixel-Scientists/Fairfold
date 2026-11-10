// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The account security routes across funders (rules 2 and 6, ADR 0004). The
// second funder's manager names the first funder's passkey and gets "not
// found" with an answer that echoes no id; so does a colleague at the first
// funder who is not the passkey's owner. A tenant, user, actor or membership
// named in a request is refused and changes nothing. It runs after the
// passkey specs, whose passkey it names.

import { signInStaff, stepUp } from '../support/api.ts';
import { person, readState } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';
import { afterTheJourney, createStaff, paced } from './people.ts';

inOrder();
afterTheJourney();

const passkeyId = () => readState().ids['passkeyId'];

test.skip(
  passkeyId() === undefined,
  'The passkey specs have not run: pnpm test:stack --project journey --workers 1 runs them first.',
);

const NAMED = ['tenantId', 'tenant_id', 'userId', 'actorId', 'membershipId'];

test.describe('account security across funders', () => {
  test('the second funder’s manager cannot remove the first funder’s passkey', async () => {
    const id = passkeyId() ?? '';
    const api = await signInStaff('eastmoor', 'eastManager');
    await stepUp(api, 'eastManager');
    const answer = await paced('remove passkey', () => api.send('DELETE', `/auth/passkeys/${id}`));
    expect(answer.status).toBe(404);
    expect(answer.text).not.toContain(id);
    await api.dispose();
  });

  test('a colleague at the first funder cannot remove it either', async () => {
    await createStaff('colleagueManager', 'programme_manager');
    const id = passkeyId() ?? '';
    const api = await signInStaff('northfield', 'colleagueManager');
    await stepUp(api, 'colleagueManager');
    const answer = await paced('remove passkey', () => api.send('DELETE', `/auth/passkeys/${id}`));
    expect(answer.status).toBe(404);
    expect(answer.text).not.toContain(id);
    await api.dispose();
  });

  test('naming a tenant, user, actor or membership is refused and changes nothing', async () => {
    const other = passkeyId() ?? '';
    const api = await signInStaff('eastmoor', 'eastManager');
    await stepUp(api, 'eastManager');
    const count = async () =>
      (await api.ok<{ remaining: number }>('GET', '/auth/backup-codes')).remaining;
    const remaining = await count();
    const passkeys = async () =>
      (await api.ok<{ passkeys: unknown[] }>('GET', '/auth/passkeys')).passkeys.length;
    const held = await passkeys();

    for (const name of NAMED) {
      for (const [method, path, json] of [
        ['GET', '/auth/passkeys', undefined],
        ['GET', '/auth/backup-codes', undefined],
      ] as const) {
        const answer = await api.send(method, path, { query: { [name]: other }, json });
        expect([400, 404, 422], `${method} ${path} with ${name} in the query`).toContain(
          answer.status,
        );
      }
      for (const [path, body] of [
        ['/auth/account/email', { email: 'renamed@example.org' }],
        ['/auth/account/password', { password: 'another long passphrase for the demo' }],
        ['/auth/passkeys/registration-options', {}],
      ] as const) {
        const answer = await api.send('POST', path, { json: { ...body, [name]: other } });
        expect([400, 404, 422], `POST ${path} with ${name} in the body`).toContain(answer.status);
      }
    }

    expect(await count()).toBe(remaining);
    expect(await passkeys()).toBe(held);
    expect((await api.send('GET', '/console/team')).status).toBe(200);
    // The account still signs in with its own address and password.
    expect(person('eastManager').email).toMatch(/@/);
    await api.dispose();
    const again = await signInStaff('eastmoor', 'eastManager');
    expect((await again.send('GET', '/console/team')).status).toBe(200);
    await again.dispose();
  });
});
