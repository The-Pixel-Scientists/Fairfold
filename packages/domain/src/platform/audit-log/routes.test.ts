// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../../api/route.ts';
import { listAuditEvents } from './routes.ts';
import { auditEventPageSchema, auditEventQuerySchema } from './schemas.ts';

const id = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0';
const membershipId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const event = {
  id,
  occurredAt: '2026-10-14T13:05:00.000Z',
  action: 'platform.membership.roles_changed',
  entityType: 'platform.membership',
  entityId: membershipId,
  actor: { kind: 'staff', membershipId, name: 'Ada Lovelace' },
  changes: {
    'app.membership.roles': { before: ['reviewer'], after: ['reviewer', 'tenant_admin'] },
    'party.person.email': {},
    f_a1b2: {},
  },
};

describe('audit log route', () => {
  it('keeps every route rule', () => {
    expect(checkRoute(listAuditEvents)).toEqual([]);
  });

  it('needs the audit permission over the whole tenant in the console', () => {
    expect(listAuditEvents).toMatchObject({
      audience: 'console',
      method: 'GET',
      path: '/console/audit-events',
      permission: 'platform.audit.read',
      scope: 'tenant',
    });
  });

  it('accepts only its filters and a cursor, each optional', () => {
    expect(Object.keys(auditEventQuerySchema.shape)).toEqual([
      'module',
      'action',
      'entityType',
      'entityId',
      'byMembershipId',
      'from',
      'to',
      'cursor',
    ]);
    expect(auditEventQuerySchema.parse({})).toEqual({});
    const filters = {
      module: 'grants',
      action: 'grants.decision.released',
      entityType: 'grants.decision',
      entityId: id,
      byMembershipId: membershipId,
      from: '2026-10-01',
      to: '2026-10-31',
      cursor: 'MjAyNi0xMC0xNA_x-1',
    };
    expect(auditEventQuerySchema.parse(filters)).toEqual(filters);
  });

  it('refuses an unknown filter key or a malformed filter', () => {
    for (const query of [
      { tenantId: id },
      { search: 'decision' },
      { module: 'finance' },
      { action: 'grants.decision' },
      { entityType: 'Grants.Decision' },
      { from: '14 October 2026' },
      { cursor: 'a b' },
    ]) {
      expect(auditEventQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('answers events with field ids, and values only where they were kept', () => {
    const page = { events: [event], nextCursor: null };
    expect(auditEventPageSchema.parse(page)).toEqual(page);
    const system = { ...event, actor: { kind: 'system' }, changes: {} };
    expect(auditEventPageSchema.parse({ events: [system], nextCursor: 'abc' }).events).toEqual([
      system,
    ]);
  });

  it('refuses changes keyed by anything but a field id, or holding an object', () => {
    for (const changes of [
      { roles: {} },
      { 'ada@example.org': {} },
      { 'app.membership.roles': { after: { name: 'Ada' } } },
    ]) {
      const page = { events: [{ ...event, changes }], nextCursor: null };
      expect(auditEventPageSchema.safeParse(page).success).toBe(false);
    }
  });

  it('names a staff member only with their membership', () => {
    const page = { events: [{ ...event, actor: { kind: 'staff', name: null } }], nextCursor: null };
    expect(auditEventPageSchema.safeParse(page).success).toBe(false);
  });

  it('shows an applicant by membership only, never by name', () => {
    const applicant = { ...event, actor: { kind: 'applicant', membershipId } };
    expect(auditEventPageSchema.parse({ events: [applicant], nextCursor: null }).events).toEqual([
      applicant,
    ]);
    for (const actor of [
      { kind: 'applicant', membershipId, name: 'Ada Lovelace' },
      { kind: 'applicant', membershipId, name: null },
      { kind: 'user', membershipId, name: 'Ada Lovelace' },
      { kind: 'system', name: 'Ada Lovelace' },
    ]) {
      const page = { events: [{ ...event, actor }], nextCursor: null };
      expect(auditEventPageSchema.safeParse(page).success, JSON.stringify(actor)).toBe(false);
    }
  });
});
