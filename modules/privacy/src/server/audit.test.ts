// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every privacy audit action says how it finds its subject, or why it has
// none (ADR 0027). A new action fails here until someone decides.

import { expect, it } from 'vitest';

import { privacyAuditActions } from '../contracts/index.ts';
import { privacySubjectRules } from './audit.ts';

it('gives each privacy audit action a rule, and a reason where it has no subject', () => {
  expect(Object.keys(privacySubjectRules).sort()).toEqual([...privacyAuditActions].sort());
  for (const rule of Object.values(privacySubjectRules)) {
    if ('none' in rule) expect(rule.none.length).toBeGreaterThan(0);
  }
});

it('gives a subject to every action on a rights request, a task or a consent history, and to no other', () => {
  const about = Object.entries(privacySubjectRules)
    .filter(([, rule]) => 'subject' in rule)
    .map(([action]) => action.split('.')[1]);

  expect(new Set(about)).toEqual(new Set(['rights_request', 'request_task', 'consent_history']));
  for (const action of privacyAuditActions) {
    const entity = action.split('.')[1] ?? '';
    expect('subject' in privacySubjectRules[action]).toBe(
      ['rights_request', 'request_task', 'consent_history'].includes(entity),
    );
  }
});
