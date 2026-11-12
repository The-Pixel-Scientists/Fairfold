// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { auditChanges } from './frameworks.ts';
import { decodeCursor, encodeCursor } from './results.ts';
import { combine, type Figure } from './summary.ts';

const figure = (value: number, periodEnd: string, writtenAt = '2026-11-01T10:00:00Z'): Figure => ({
  value,
  periodEnd,
  writtenAt: new Date(writtenAt),
});

describe('combine', () => {
  const figures = [
    figure(0.1, '2026-03-31'),
    figure(0.2, '2027-03-31', '2026-11-01T10:00:00Z'),
    figure(0.7, '2027-03-31', '2026-11-02T10:00:00Z'),
    figure(3.21, '2025-03-31', '2026-12-01T10:00:00Z'),
  ];

  it('is null for no figures, whatever the rule', () => {
    expect(combine('sum', [])).toBeNull();
    expect(combine('average', [])).toBeNull();
    expect(combine('latest', [])).toBeNull();
  });

  it('adds hundredths exactly', () => {
    expect(combine('sum', figures)).toBe(4.21);
    expect(combine('sum', [figure(0.1, '2026-03-31'), figure(0.2, '2026-03-31')])).toBe(0.3);
  });

  it('averages to 2 decimal places', () => {
    expect(combine('average', figures)).toBe(1.05);
    expect(combine('average', [figure(1, '2026-03-31'), figure(2, '2026-03-31')])).toBe(1.5);
  });

  it('takes the figure whose period ends last, and of those the one written last', () => {
    expect(combine('latest', figures)).toBe(0.7);
    expect(combine('latest', [...figures].reverse())).toBe(0.7);
  });
});

describe('a results cursor', () => {
  const id = '0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f';

  it('reads back what it was made from', () => {
    const cursor = encodeCursor('2027-03-31', id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ periodEnd: '2027-03-31', id });
  });

  it('is refused when it is anything else', () => {
    const encode = (text: string) => Buffer.from(text).toString('base64url');
    for (const text of ['', 'not a cursor', `2027-03-31 ${id} more`, `31/03/2027 ${id}`, id]) {
      expect(decodeCursor(encode(text)), text).toBeNull();
    }
  });
});

describe('the audit changes of a framework diff', () => {
  const id = '0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f';

  it('hold the name, and name the other columns without their values', () => {
    expect(
      auditChanges([
        { path: 'name', from: 'Before', to: 'After' },
        { path: 'description', from: '', to: 'Words about the work.' },
        { path: `outcomes.${id}.description`, from: null, to: 'More words.' },
        { path: `indicators.${id}.outcome`, from: null, to: id },
        { path: `indicators.${id}.unit`, from: null, to: 'people' },
      ]),
    ).toEqual({
      'impact.framework.name': { before: 'Before', after: 'After' },
      'impact.framework.description': {},
      'impact.outcome.description': {},
      'impact.indicator.outcome_id': {},
      'impact.indicator.unit': {},
    });
  });

  it('refuse a path the diff schema does not know', () => {
    expect(() =>
      auditChanges([{ path: `outcomes.${id}.colour`, from: null, to: 'red' }]),
    ).toThrow();
  });
});
