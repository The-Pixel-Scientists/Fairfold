// SPDX-License-Identifier: AGPL-3.0-or-later

import { insertAuditEvent, type Transaction } from '@pixel-scientists/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordAudit, recordRead, type AuditActor } from './writer.ts';

vi.mock('@pixel-scientists/db', () => ({ insertAuditEvent: vi.fn(() => Promise.resolve()) }));

const trx = {} as Transaction<unknown>;
const requestId = '0b6f1c1e-3a2d-4c5b-8e7f-9a0b1c2d3e4f';
const membershipId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const entityId = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0';
const user: AuditActor = { kind: 'user', membershipId, requestId };

beforeEach(() => {
  vi.mocked(insertAuditEvent).mockClear();
});

describe('recordAudit', () => {
  it("records a user's change with the action's entity type", async () => {
    const changes = { 'app.membership.roles': { before: ['reviewer'], after: ['tenant_admin'] } };
    await recordAudit(trx, user, {
      action: 'platform.membership.roles_changed',
      entityId,
      changes,
    });
    expect(insertAuditEvent).toHaveBeenCalledWith(trx, {
      requestId,
      actorKind: 'user',
      actorId: membershipId,
      action: 'platform.membership.roles_changed',
      entityType: 'platform.membership',
      entityId,
      changes,
      subjectPartyId: null,
    });
  });

  it('records the party the event is about', async () => {
    const subjectPartyId = '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09';
    await recordAudit(trx, user, {
      action: 'platform.membership.roles_changed',
      entityId,
      subjectPartyId,
    });
    expect(insertAuditEvent).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ entityType: 'platform.membership', subjectPartyId }),
    );
  });

  it.each([
    '',
    'not-a-uuid',
    '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09 OR true',
    'someone@example.org',
  ])('refuses the subject party id %j without repeating it', async (subjectPartyId) => {
    const refusal = recordAudit(trx, user, {
      action: 'platform.membership.roles_changed',
      entityId,
      subjectPartyId,
    });
    await expect(refusal).rejects.toThrow(/^Audit subject party id is not a UUID\.$/);
    if (subjectPartyId) await expect(refusal).rejects.not.toThrow(subjectPartyId);
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it('records no membership for the system or the operator', async () => {
    await recordAudit(
      trx,
      { kind: 'operator', requestId },
      {
        action: 'platform.tenant.created',
        entityId,
      },
    );
    expect(insertAuditEvent).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ actorKind: 'operator', actorId: null, changes: {} }),
    );
  });

  it.each(['platform.tenant.deleted', 'grants.nothing.happened', 'platform.tenant'])(
    'refuses %s, which no list defines, without repeating it',
    async (action) => {
      const refusal = recordAudit(trx, user, {
        action: action as 'platform.tenant.created',
        entityId,
      });
      await expect(refusal).rejects.toThrow(/^Audit action is not in any module's list\.$/);
      await expect(refusal).rejects.not.toThrow(action);
      expect(insertAuditEvent).not.toHaveBeenCalled();
    },
  );
});

describe('recordRead', () => {
  it('records the read with no changes', async () => {
    await recordRead(trx, user, { action: 'platform.warehouse.exported', entityId });
    expect(insertAuditEvent).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ action: 'platform.warehouse.exported', entityId, changes: {} }),
    );
  });

  it('records the party whose data was read', async () => {
    const subjectPartyId = '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09';
    await recordRead(trx, user, {
      action: 'platform.warehouse.exported',
      entityId,
      subjectPartyId,
    });
    expect(insertAuditEvent).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ action: 'platform.warehouse.exported', subjectPartyId }),
    );
  });
});
