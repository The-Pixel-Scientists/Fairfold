// SPDX-License-Identifier: AGPL-3.0-or-later
//
// createJobRequest() takes the requester, tenant and output sensitivity
// from the session, the transaction and the classification map: a request
// cannot carry them, and a field the map does not know stops it before any
// write.

import { randomUUID } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import { describe, expect, it } from 'vitest';

import { createJobRequest, type JobRequestActor, type JobRequestInput } from './job-request.ts';

const actor: JobRequestActor = {
  kind: 'user',
  membershipId: randomUUID(),
  requestId: randomUUID(),
};
const request: JobRequestInput = {
  kind: 'subject_access',
  permission: 'platform.subject_access.request',
  filters: { partyId: randomUUID() },
  fieldIds: ['party.person.email'],
};

/** A transaction that fails the test if anything uses it. */
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error('The transaction was used.');
    },
  },
) as Transaction<unknown>;

describe('createJobRequest', () => {
  it('takes no requester, tenant or sensitivity from the request', () => {
    const carrying: JobRequestInput[] = [
      // @ts-expect-error The requester comes from the session.
      { ...request, requestedBy: randomUUID() },
      // @ts-expect-error The tenant comes from the transaction.
      { ...request, tenantId: randomUUID() },
      // @ts-expect-error The sensitivity comes from the classification map.
      { ...request, outputSensitivity: 'public' },
    ];
    expect(carrying).toHaveLength(3);
  });

  it('acts only for a member', () => {
    // @ts-expect-error A system or operator actor has no membership to ask as.
    const system: JobRequestActor = { kind: 'system', requestId: randomUUID() };
    expect(system.kind).toBe('system');
  });

  it('writes nothing for a field the classification map does not know', async () => {
    await expect(
      createJobRequest(
        untouched,
        actor,
        { ...request, fieldIds: ['party.person.nickname'] },
        'platform.subject_access.requested',
      ),
    ).rejects.toThrow('is not in the classification map');
  });
});
