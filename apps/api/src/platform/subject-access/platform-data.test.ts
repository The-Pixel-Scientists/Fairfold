// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fails when a platform table with a subject path is neither read for an
// export nor excluded with a reason, so a new table cannot drop out of every
// subject access export without anyone deciding it.

import { classification, subjectPaths } from '@pixel-scientists/db/classification';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_COLUMN,
  excludedTables,
  membershipTables,
  withheldAuditActions,
  withheldAuditFields,
  withheldColumns,
} from './platform-data.ts';

describe('platform subject tables', () => {
  it('reads the memberships by the account column of their subject path', () => {
    expect(subjectPaths['app.membership']).toEqual({ kind: 'account', column: ACCOUNT_COLUMN });
  });

  it('reads or excludes, with a reason, every app table that has a subject path', () => {
    const left = Object.keys(subjectPaths).filter(
      (table) =>
        table.startsWith('app.') &&
        table !== 'app.membership' &&
        !(table in membershipTables) &&
        !(table in excludedTables),
    );
    expect(left).toEqual([]);
    expect(Object.values(excludedTables).every((reason) => reason !== '')).toBe(true);
  });

  it('reads the files, invitations and job requests through their memberships', () => {
    expect(membershipTables).toEqual({
      'app.file': 'created_by',
      'app.invitation': 'accepted_membership_id',
      'app.job_request': 'requested_by',
    });
  });

  it('excludes every unlinked table, and names only tables and columns the map lists', () => {
    for (const [table, path] of Object.entries(subjectPaths)) {
      if (table.startsWith('app.') && path.kind === 'unlinked')
        expect(excludedTables).toHaveProperty(table);
    }
    for (const table of Object.keys(excludedTables)) expect(subjectPaths).toHaveProperty(table);
    for (const id of Object.keys(withheldColumns)) {
      const [, table = '', column = ''] = /^(.+\..+)\.([^.]+)$/.exec(id) ?? [];
      expect(classification[table]).toHaveProperty(column);
    }
  });

  it('gives a plain reason for everything it withholds', () => {
    for (const manifest of [withheldColumns, withheldAuditActions, withheldAuditFields]) {
      expect(Object.values(manifest).every((reason) => reason !== '')).toBe(true);
    }
    expect(withheldColumns).toHaveProperty(['app.job_request.filters']);
  });

  it('withholds every audit event that names a reviewer, shows review progress or holds an unreleased outcome', () => {
    expect(Object.keys(withheldAuditActions).sort()).toEqual([
      'grants.application.stage_changed',
      'grants.assignment.conflict_declared',
      'grants.assignment.created',
      'grants.assignment.removed',
      'grants.decision.changed',
      'grants.decision.recorded',
      'grants.review.submitted',
      'grants.reviewer.added',
      'grants.reviewer.removed',
    ]);
  });
});
