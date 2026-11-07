// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../../api/route.ts';
import {
  exportAuditEvents,
  listAuditEvents,
  readAuditExport,
  searchAuditEvents,
} from './routes.ts';
import {
  auditEventPageSchema,
  auditEventQuerySchema,
  auditExportFiltersSchema,
  auditSearchPageSchema,
  auditSearchSchema,
} from './schemas.ts';

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

describe('audit log search and export', () => {
  const partyId = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
  const filters = {
    module: 'party',
    action: 'party.person.updated',
    entityType: 'party.person',
    entityId: id,
    byMembershipId: membershipId,
    from: '2026-10-01',
    to: '2026-10-31',
    subjectPartyId: partyId,
  };

  it('keep every route rule', () => {
    for (const route of [searchAuditEvents, exportAuditEvents, readAuditExport]) {
      expect(checkRoute(route), route.path).toEqual([]);
    }
  });

  it('search with the filters in the body, under the read permission, without step-up', () => {
    expect(searchAuditEvents).toMatchObject({
      method: 'POST',
      path: '/console/audit-events/search',
      permission: 'platform.audit.read',
      scope: 'tenant',
    });
    expect('query' in searchAuditEvents).toBe(false);
    expect('idempotent' in searchAuditEvents).toBe(false);
    expect('stepUp' in searchAuditEvents).toBe(false);
    expect(auditSearchSchema.parse({ ...filters, cursor: 'abc' })).toEqual({
      ...filters,
      cursor: 'abc',
    });
    expect(auditSearchSchema.parse({})).toEqual({});
  });

  it('export the same filters without a cursor, as an idempotent job under step-up', () => {
    expect(exportAuditEvents).toMatchObject({
      method: 'POST',
      path: '/console/audit-events/exports',
      permission: 'platform.audit.export',
      stepUp: true,
      idempotent: true,
    });
    expect(Object.keys(exportAuditEvents.responses)).toEqual(['202']);
    expect(auditExportFiltersSchema.parse(filters)).toEqual(filters);
    expect(auditExportFiltersSchema.safeParse({ ...filters, cursor: 'abc' }).success).toBe(false);
    expect(readAuditExport).toMatchObject({
      method: 'GET',
      path: '/console/audit-events/exports/:requestId',
      permission: 'platform.audit.export',
    });
  });

  it('refuse an unknown key or a subject that is not an id', () => {
    for (const body of [
      { tenantId: id },
      { subjectPartyId: 'Ada Lovelace' },
      { subjectName: 'Ada Lovelace' },
      { search: 'Ada' },
    ]) {
      expect(auditSearchSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
      expect(auditExportFiltersSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('answer each event with its subject party id, or null, and never a name', () => {
    const page = { events: [{ ...event, subjectPartyId: partyId }], nextCursor: null };
    expect(auditSearchPageSchema.parse(page)).toEqual(page);
    const none = { events: [{ ...event, subjectPartyId: null }], nextCursor: 'abc' };
    expect(auditSearchPageSchema.parse(none)).toEqual(none);
    for (const subjectPartyId of [undefined, 'Ada Lovelace']) {
      const bad = { events: [{ ...event, subjectPartyId }], nextCursor: null };
      expect(auditSearchPageSchema.safeParse(bad).success, String(subjectPartyId)).toBe(false);
    }
  });

  it('leave the MVP1 list as it was', () => {
    expect(listAuditEvents.responses).toEqual({ 200: auditEventPageSchema });
    expect(auditEventPageSchema.parse({ events: [event], nextCursor: null })).toEqual({
      events: [event],
      nextCursor: null,
    });
  });
});
