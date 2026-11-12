// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every impact audit action says why it carries no subject (ADR 0027). A
// new action fails here until someone decides whether it has one.

import { expect, it } from 'vitest';

import { impactAuditActions } from '../contracts/index.ts';
import { impactSubjectRules } from './audit.ts';

it('each impact audit action gives a reason for having no subject, and no other is listed', () => {
  expect(Object.keys(impactSubjectRules).sort()).toEqual([...impactAuditActions].sort());
  for (const rule of Object.values(impactSubjectRules)) {
    expect(rule.none.length).toBeGreaterThan(0);
  }
});
