// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { checkRoute, type RouteContract } from '../../api/route.ts';
import { auditLogRoutes } from '../audit-log/routes.ts';
import { fieldForIssue, messageForIssue, messages } from '../messages.ts';
import { retentionRoutes } from '../retention/routes.ts';
import { erasureRequestSchema, erasureStatusSchema } from './erasure.ts';
import * as subjectAccess from './routes.ts';
import { jobRequestSchema, requestAcceptedSchema, subjectAccessRequestSchema } from './schemas.ts';

const { subjectAccessRoutes } = subjectAccess;

const partyId = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const requestId = '9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0';
const requestedAt = '2026-11-12T10:00:00.000Z';

/** Every route the E3 contracts define, the MVP1 audit list included. */
const e3Routes: Record<string, RouteContract> = {
  ...retentionRoutes,
  ...subjectAccessRoutes,
  ...auditLogRoutes,
};

const named = (test: (route: RouteContract) => boolean) =>
  Object.entries(e3Routes)
    .filter(([, route]) => test(route))
    .map(([name]) => name)
    .sort();

describe('E3 routes', () => {
  it('keep every route rule, in the platform module over the whole tenant', () => {
    expect(Object.keys(e3Routes)).toHaveLength(10);
    for (const [name, route] of Object.entries(e3Routes)) {
      expect(checkRoute(route), name).toEqual([]);
      expect(route, name).toMatchObject({
        audience: 'console',
        module: 'platform',
        scope: 'tenant',
      });
    }
    const exported = Object.values(subjectAccess).filter((value) => 'audience' in value);
    expect(exported).toEqual(Object.values(subjectAccessRoutes));
  });

  it('need step-up for exactly the changes and exports', () => {
    expect(named((route) => 'stepUp' in route && route.stepUp === true)).toEqual([
      'changeRetentionPolicy',
      'exportAuditEvents',
      'requestErasure',
      'requestSubjectAccess',
    ]);
  });

  it('are idempotent for exactly the requests that start a job', () => {
    expect(named((route) => route.idempotent === true)).toEqual([
      'exportAuditEvents',
      'requestErasure',
      'requestSubjectAccess',
    ]);
    for (const name of named((route) => route.idempotent === true)) {
      expect(e3Routes[name]?.responses).toEqual({ 202: requestAcceptedSchema });
    }
  });

  it('use the permissions S11-21 added', () => {
    expect(
      Object.fromEntries(Object.entries(e3Routes).map(([name, route]) => [name, route.permission])),
    ).toEqual({
      listRetentionPolicies: 'platform.retention.manage',
      changeRetentionPolicy: 'platform.retention.manage',
      requestSubjectAccess: 'platform.subject_access.request',
      readSubjectAccessRequest: 'platform.subject_access.request',
      requestErasure: 'platform.erasure.request',
      readErasureRequest: 'platform.erasure.request',
      listAuditEvents: 'platform.audit.read',
      searchAuditEvents: 'platform.audit.read',
      exportAuditEvents: 'platform.audit.export',
      readAuditExport: 'platform.audit.export',
    });
  });
});

describe('subject access request', () => {
  it('takes one party id and nothing else', () => {
    expect(subjectAccessRequestSchema.parse({ partyId })).toEqual({ partyId });
    for (const body of [{}, { partyId, membershipId: requestId }, { partyId: [partyId] }]) {
      expect(subjectAccessRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('reads as a status with a file once ready and a code if it failed', () => {
    const statuses = [
      { id: requestId, requestedAt, status: 'queued' },
      { id: requestId, requestedAt, status: 'expired' },
      {
        id: requestId,
        requestedAt,
        status: 'ready',
        fileId: partyId,
        expiresAt: '2026-11-19T10:00:00.000Z',
      },
      { id: requestId, requestedAt, status: 'failed', failureCode: 'storage_unavailable' },
    ];
    for (const status of statuses) expect(jobRequestSchema.parse(status)).toEqual(status);
    for (const status of [
      { id: requestId, requestedAt, status: 'ready' },
      { id: requestId, requestedAt, status: 'queued', fileId: partyId },
      { id: requestId, requestedAt, status: 'failed', failureCode: 'Disk full on node 3' },
      { id: requestId, requestedAt, status: 'failed', failureCode: 'x', message: 'Disk full' },
      { id: requestId, requestedAt, status: 'cancelled' },
      { id: requestId, requestedAt, status: 'queued', requestedBy: 'Ada Lovelace' },
    ]) {
      expect(jobRequestSchema.safeParse(status).success, JSON.stringify(status)).toBe(false);
    }
  });
});

describe('erasure request', () => {
  const body = { partyId, reason: 'subject_request', confirm: true };

  it('takes one party, a reason from the list and a literal confirmation', () => {
    expect(erasureRequestSchema.parse(body)).toEqual(body);
    expect(erasureRequestSchema.parse({ ...body, reason: 'tenant_instruction' }).reason).toBe(
      'tenant_instruction',
    );
    for (const refused of [
      { ...body, confirm: 'true' },
      { ...body, confirm: false },
      { partyId, reason: 'subject_request' },
      { ...body, reason: 'retention' },
      { ...body, partyIds: [partyId] },
      { ...body, partyId: undefined, filter: { status: 'inactive' } },
      { ...body, membershipId: requestId },
      { ...body, scheduledFor: '2027-01-01' },
    ]) {
      expect(erasureRequestSchema.safeParse(refused).success, JSON.stringify(refused)).toBe(false);
    }
  });

  it('words its problems from the catalogue', () => {
    const issues = erasureRequestSchema.safeParse({ partyId, reason: 'other', confirm: false })
      .error?.issues;
    expect(issues?.map((issue) => messageForIssue(issue))).toEqual([
      messages.erasureReason,
      messages.erasureConfirm,
    ]);
  });

  it('reads as a status with counts by table when done and a code if it failed', () => {
    const done = {
      id: requestId,
      requestedAt,
      status: 'done',
      counts: { 'party.person': 1, 'grants.application': 2 },
    };
    expect(erasureStatusSchema.parse(done)).toEqual(done);
    expect(
      erasureStatusSchema.parse({
        id: requestId,
        requestedAt,
        status: 'failed',
        failureCode: 'staff_membership',
      }).status,
    ).toBe('failed');
    for (const status of [
      { ...done, counts: { 'party.person': { given_name: 'Ada' } } },
      { ...done, counts: { 'party.person': -1 } },
      { ...done, counts: { person: 1 } },
      { ...done, status: 'ready' },
      { id: requestId, requestedAt, status: 'running', counts: {} },
    ]) {
      expect(erasureStatusSchema.safeParse(status).success, JSON.stringify(status)).toBe(false);
    }
  });

  it('say what to do about a member of staff, without apologising', () => {
    for (const message of [
      messages.erasureReason,
      messages.erasureConfirm,
      messages.erasureStaffMember,
    ]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(/sorry|apolog/i);
    }
  });
});

describe('problems from these requests', () => {
  const recognisable = 'ada-lovelace-1815-12-10';

  function problemText(schema: z.ZodType, value: unknown): string {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return (result.error?.issues ?? [])
      .map((issue) => `${fieldForIssue('body', issue)} ${messageForIssue(issue)}`)
      .join('\n');
  }

  it('never repeat a party id that was sent', () => {
    const bodies: [z.ZodType, unknown][] = [
      [subjectAccessRequestSchema, { partyId: recognisable }],
      [subjectAccessRequestSchema, { partyId, [recognisable]: partyId }],
      [
        erasureRequestSchema,
        { partyId: recognisable, reason: recognisable, confirm: recognisable },
      ],
      [erasureRequestSchema, { partyId, reason: 'subject_request', confirm: false, note: partyId }],
    ];
    for (const [schema, value] of bodies) {
      const text = problemText(schema, value);
      expect(text).not.toContain(recognisable);
      expect(text).not.toContain(partyId);
    }
  });
});
