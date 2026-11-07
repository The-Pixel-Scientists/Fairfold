// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from '../id.ts';
import { defineEvent } from './define.ts';
import { EventParseError, eventEnvelope, parseEvent } from './envelope.ts';
import { payloadLeafProblems } from './payload.ts';

const released = defineEvent('grants.decision_released.v1', {
  read: 'grants.applications.read',
  data: z.strictObject({ decisionId: idSchema, applicationId: idSchema }),
});

const envelope = {
  id: '0b6c7a1e-1f9d-4c55-9a51-3f1f2b6f0a01',
  type: 'grants.decision_released.v1',
  tenantId: '0b6c7a1e-1f9d-4c55-9a51-3f1f2b6f0a02',
  sequence: 12,
  occurredAt: '2026-11-10T09:30:00.000+00:00',
  requestId: '0b6c7a1e-1f9d-4c55-9a51-3f1f2b6f0a03',
  causedBy: null,
  data: {
    decisionId: '0b6c7a1e-1f9d-4c55-9a51-3f1f2b6f0a04',
    applicationId: '0b6c7a1e-1f9d-4c55-9a51-3f1f2b6f0a05',
  },
};

function parseError(input: unknown): EventParseError {
  try {
    parseEvent(input);
  } catch (error) {
    if (error instanceof EventParseError) return error;
  }
  throw new Error('expected an EventParseError');
}

describe('eventEnvelope', () => {
  it('has exactly the fields ADR 0034 fixes', () => {
    expect(Object.keys(eventEnvelope(released).shape).sort()).toEqual([
      'causedBy',
      'data',
      'id',
      'occurredAt',
      'requestId',
      'sequence',
      'tenantId',
      'type',
    ]);
  });

  it('keeps the payload leaf rules itself', () => {
    expect(payloadLeafProblems(eventEnvelope(released))).toEqual([]);
  });
});

describe('parseEvent', () => {
  it('parses a valid envelope, before and after the outbox numbers it', () => {
    expect(parseEvent(envelope)).toEqual(envelope);
    expect(parseEvent({ ...envelope, sequence: null, causedBy: envelope.id })).toMatchObject({
      sequence: null,
    });
  });

  it('refuses an unknown type, naming it only when it is a well-formed name', () => {
    expect(parseError({ ...envelope, type: 'grants.decision_released.v9' })).toMatchObject({
      type: 'grants.decision_released.v9',
      paths: ['type'],
    });
    for (const input of [{ ...envelope, type: 'Ada Lovelace' }, null, 'grants', {}]) {
      expect(parseError(input)).toMatchObject({ type: null, paths: ['type'] });
    }
  });

  it('names the type and paths of a failing envelope, never the values', () => {
    const secret = 'ada@example.org';
    const error = parseError({
      ...envelope,
      sequence: 0,
      occurredAt: '2026-11-10T09:30:00',
      data: { ...envelope.data, applicationId: secret, note: secret },
    });
    expect(error.type).toBe('grants.decision_released.v1');
    expect([...error.paths].sort()).toEqual([
      'data',
      'data.applicationId',
      'occurredAt',
      'sequence',
    ]);
    expect(JSON.stringify([error.message, error.type, error.paths])).not.toContain('ada');
    expect(error.cause).toBeUndefined();
  });

  it('refuses keys outside the envelope', () => {
    expect(parseError({ ...envelope, actorName: 'Ada' }).paths).toEqual(['the envelope']);
  });
});
