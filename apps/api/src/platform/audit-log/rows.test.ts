// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { JobError } from '@pixel-scientists/db/jobs';
import type { AuditSearch, AuditSearchPage } from '@pixel-scientists/domain/platform/audit-log';
import { describe, expect, it } from 'vitest';

import { mostSensitive } from '../../../../../packages/db/src/job-request.ts';
import { csvChunks } from '../csv/index.ts';
import {
  AUDIT_EXPORT_FIELD_IDS,
  AUDIT_EXPORT_HEADING,
  AUDIT_EXPORT_ROW_LIMIT,
  auditExportRow,
  auditExportRows,
  localTime,
} from './rows.ts';

const event = (change: Partial<AuditSearchPage['events'][number]> = {}) => ({
  id: randomUUID(),
  occurredAt: '2026-03-29T00:30:00.000Z',
  action: 'grants.decision.released',
  entityType: 'grants.decision',
  entityId: randomUUID(),
  actor: { kind: 'system' as const },
  changes: {},
  subjectPartyId: null,
  ...change,
});

/** Pages of `size` events from a list, with a cursor that is the next offset. */
const pagesOf =
  (events: ReturnType<typeof event>[], size: number, seen: AuditSearch[] = []) =>
  (search: AuditSearch): Promise<AuditSearchPage> => {
    seen.push(search);
    const from = search.cursor === undefined ? 0 : Number(search.cursor);
    const next = from + size;
    return Promise.resolve({
      events: events.slice(from, next),
      nextCursor: next < events.length ? String(next) : null,
    });
  };

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const row of rows) all.push(row);
  return all;
}

describe('the audit export columns', () => {
  it('are all in the classification map, and the file is personal because of the name', () => {
    expect(mostSensitive(AUDIT_EXPORT_FIELD_IDS)).toBe('personal');
    const withoutName = AUDIT_EXPORT_FIELD_IDS.filter((id) => !id.startsWith('party.'));
    expect(mostSensitive(withoutName)).not.toBe('personal');
  });
});

describe('localTime', () => {
  it('writes the wall clock of the tenant zone, across a clock change', () => {
    expect(localTime(new Date('2026-03-29T00:59:59Z'), 'Europe/London')).toBe(
      '2026-03-29 00:59:59',
    );
    expect(localTime(new Date('2026-03-29T01:00:00Z'), 'Europe/London')).toBe(
      '2026-03-29 02:00:00',
    );
    expect(localTime(new Date('2026-03-29T00:00:00Z'), 'Pacific/Pago_Pago')).toBe(
      '2026-03-28 13:00:00',
    );
  });
});

describe('auditExportRow', () => {
  it('names a member, the action in words and as a code, and the changes as stored', () => {
    const subject = randomUUID();
    const membershipId = randomUUID();
    const row = auditExportRow(
      event({
        actor: { kind: 'staff', membershipId, name: 'Ada Lovelace' },
        subjectPartyId: subject,
        changes: { 'grants.decision.outcome': { after: 'award' } },
      }),
      'Europe/London',
    );

    expect(row).toEqual([
      '2026-03-29 00:30:00',
      '2026-03-29T00:30:00.000Z',
      'Ada Lovelace',
      membershipId,
      'Decision released',
      'grants.decision.released',
      'grants',
      'grants.decision',
      expect.any(String),
      subject,
      '{"grants.decision.outcome":{"after":"award"}}',
    ]);
  });

  it('says what kind of actor a nameless or unnamed one is, never a name for an applicant', () => {
    const id = randomUUID();
    const cells = (actor: ReturnType<typeof event>['actor']) =>
      auditExportRow(event({ actor }), 'UTC').slice(2, 4);

    expect(cells({ kind: 'staff', membershipId: id, name: null })).toEqual(['Team member', id]);
    expect(cells({ kind: 'applicant', membershipId: id })).toEqual(['Applicant', id]);
    expect(cells({ kind: 'system' })).toEqual(['System', null]);
    expect(cells({ kind: 'operator' })).toEqual(['Operator', null]);
  });
});

describe('auditExportRows', () => {
  it('reads every page in turn with the same filters and the cursor', async () => {
    const seen: AuditSearch[] = [];
    const events = Array.from({ length: 5 }, () => event());

    const rows = await collect(
      auditExportRows(pagesOf(events, 2, seen), { subjectPartyId: events[0]?.id }, 'UTC'),
    );

    expect(rows).toHaveLength(5);
    expect(seen.map((search) => search.cursor)).toEqual([undefined, '2', '4']);
    expect(seen.every((search) => search.subjectPartyId === events[0]?.id)).toBe(true);
  });

  it('feeds the CSV writer a row at a time, with a name that looks like a formula escaped', async () => {
    const events = [
      event({ actor: { kind: 'staff', membershipId: randomUUID(), name: '=HYPERLINK("x")' } }),
    ];
    let text = '';
    for await (const chunk of csvChunks(
      AUDIT_EXPORT_HEADING,
      auditExportRows(pagesOf(events, 100), {}, 'UTC'),
    )) {
      text += chunk;
    }

    expect(text.startsWith('﻿Time (tenant time zone),Time (UTC),Actor,')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text.split('\r\n')).toHaveLength(3);
  });

  it('fails with a code, never a short file, past the row limit', async () => {
    const same = event();
    const readPage = (): Promise<AuditSearchPage> =>
      Promise.resolve({ events: [same, same, same], nextCursor: '1' });
    const rows = auditExportRows(readPage, {}, 'UTC', 7);

    await expect(collect(rows)).rejects.toEqual(new JobError('precondition_failed'));
    expect(AUDIT_EXPORT_ROW_LIMIT).toBe(500_000);
  });
});
