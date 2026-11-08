// SPDX-License-Identifier: AGPL-3.0-or-later

import { subjectAccessExportSchema } from '@pixel-scientists/domain/platform/subject-access';
import { describe, expect, it } from 'vitest';

import { exportChunks, outputSensitivity, type SubjectAccessData } from './export-file.ts';

const tenantId = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const partyId = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const header = { tenantId, subjectPartyId: partyId, createdAt: '2026-11-12T10:00:00.000Z' };

const data: SubjectAccessData = {
  modules: {
    party: {
      'party.person': [
        {
          'party.person.id': { value: partyId, sensitivity: 'internal' },
          'party.person.given_name': { value: 'Ada', sensitivity: 'personal' },
        },
      ],
      'party.consent': [],
    },
    grants: {
      'grants.application': [
        {
          'grants.application.status': { value: 'submitted', sensitivity: 'internal' },
          f_lived1: { value: ['Yes'], sensitivity: 'special_category' },
        },
      ],
    },
  },
  auditEvents: [
    {
      id: tenantId,
      occurredAt: '2026-10-14T13:05:00.000Z',
      action: 'party.person.updated',
      entityType: 'party.person',
      entityId: partyId,
      actor: { kind: 'staff' },
      changes: { 'party.person.given_name': {} },
    },
  ],
};

const text = (source: Iterable<string>): string => [...source].join('');

describe('exportChunks', () => {
  it('writes the document the shared schema defines, header first', () => {
    const file = text(exportChunks(header, data));
    expect(file.startsWith('{"version":1,"tenantId":')).toBe(true);
    expect(subjectAccessExportSchema.parse(JSON.parse(file))).toEqual({
      version: 1,
      ...header,
      modules: data.modules,
      auditEvents: data.auditEvents,
    });
  });

  it('writes an empty person as valid JSON', () => {
    const file = text(exportChunks(header, { modules: {}, auditEvents: [] }));
    expect(subjectAccessExportSchema.parse(JSON.parse(file)).auditEvents).toEqual([]);
  });

  it('yields many pieces, never one string for the whole file', () => {
    const pieces: string[] = [];
    pieces.push(...exportChunks(header, data));
    expect(pieces.length).toBeGreaterThan(8);
  });
});

describe('outputSensitivity', () => {
  it('is special category when a special category answer is written', () => {
    expect(outputSensitivity(data)).toBe('special_category');
  });

  it('is the highest map class otherwise', () => {
    const columns = {
      'grants.application.status': { value: 'submitted', sensitivity: 'internal' as const },
    };
    expect(
      outputSensitivity({
        modules: { grants: { 'grants.application': [columns] } },
        auditEvents: [],
      }),
    ).toBe('internal');
    expect(
      outputSensitivity({
        modules: data.modules.party ? { party: data.modules.party } : {},
        auditEvents: [],
      }),
    ).toBe('personal');
  });

  it('throws for a column the classification map does not list', () => {
    expect(() =>
      outputSensitivity({
        modules: {
          party: {
            'party.person': [{ 'party.person.nickname': { value: 'x', sensitivity: 'public' } }],
          },
        },
        auditEvents: [],
      }),
    ).toThrow('not in the classification map');
  });

  it('throws for an empty file rather than classing it low', () => {
    expect(() => outputSensitivity({ modules: {}, auditEvents: [] })).toThrow();
  });
});
