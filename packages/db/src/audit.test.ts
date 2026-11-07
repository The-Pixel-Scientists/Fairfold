// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { insertAuditEvent, keptChanges } from './audit.ts';

/** The whole message, so a refused key is never repeated in it. */
const REFUSED = /^Audit changes are keyed by a classified column id or a form field id\.$/;

describe('keptChanges', () => {
  it('keeps values of public and internal columns, and only the id of other fields', () => {
    expect(
      keptChanges({
        'app.tenant.name': { before: 'Old name', after: 'New name' },
        'app.membership.roles': { after: ['reviewer'] },
        'app.membership.user_id': { before: 'a-personal-value', after: 'another' },
        f_answer1: { after: 'an answer' },
      }),
    ).toEqual({
      'app.tenant.name': { before: 'Old name', after: 'New name' },
      'app.membership.roles': { after: ['reviewer'] },
      'app.membership.user_id': {},
      f_answer1: {},
    });
  });

  it.each([
    'someone@example.org',
    'jane.smith.gmail_com',
    'app.membership.not_a_column',
    'nowhere.table.column',
    'app.tenant.constructor',
    'app.__proto__.name',
    'app.membership',
    'App.Tenant.Name',
    '__proto__',
    '',
  ])('refuses %j, which is not a classified column or a form field id', (field) => {
    expect(() => keptChanges({ [field]: { after: 'x' } })).toThrow(REFUSED);
  });

  it('refuses the whole change set when one key is not classified', () => {
    expect(() =>
      keptChanges({
        'app.tenant.name': { after: 'New name' },
        'jane.smith.gmail_com': { after: 'x' },
      }),
    ).toThrow(REFUSED);
  });
});

describe('keptChanges, by column and value shape', () => {
  it.each([
    'app.config_version.diff',
    'app.tenant_theme.tokens',
    'app.tenant_theme.logo',
    'app.audit_event.changes',
  ])('records %s, a structured column, by its id alone', (field) => {
    expect(keptChanges({ [field]: { before: 'a', after: 'b' } })).toEqual({ [field]: {} });
  });

  it.each([
    ['an object', { name: 'x' }],
    ['a nested list', [['reviewer']]],
    ['a list of 21 items', Array.from({ length: 21 }, (_, i) => `r${String(i)}`)],
    ['a big integer', 1n],
    ['a function', () => 'x'],
  ])('records a public or internal field by its id alone when its value is %s', (_, value) => {
    expect(keptChanges({ 'app.tenant.status': { before: 'active', after: value } })).toEqual({
      'app.tenant.status': {},
    });
  });

  it('keeps strings, numbers, booleans, null and short lists of them', () => {
    const changes = {
      'app.tenant.name': { before: 'Old name', after: 'New name' },
      'app.tenant.fiscal_year_start_month': { before: 4, after: 1 },
      'app.tenant_module.enabled': { before: false, after: true },
      'app.invitation.accepted_membership_id': { before: null },
      'app.membership.roles': { after: Array.from({ length: 20 }, () => 'reviewer') },
    };
    expect(keptChanges(changes)).toEqual(changes);
  });
});

describe('insertAuditEvent', () => {
  it('refuses changes over 65,536 bytes before it sends anything', async () => {
    const trx = {} as Transaction<unknown>;
    const name = 'n'.repeat(65_536);
    await expect(
      insertAuditEvent(trx, {
        requestId: 'r',
        actorKind: 'system',
        actorId: null,
        action: 'platform.tenant.updated',
        entityType: 'platform.tenant',
        entityId: 'e',
        changes: { 'app.tenant.name': { after: name } },
      }),
    ).rejects.toThrow(/^Audit changes are larger than 65,536 bytes\.$/);
  });
});
