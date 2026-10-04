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
    });
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
    'refuses %s, which no list defines',
    async (action) => {
      await expect(
        recordAudit(trx, user, { action: action as 'platform.tenant.created', entityId }),
      ).rejects.toThrow(`Audit action ${action} is not in any module's list.`);
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
});
