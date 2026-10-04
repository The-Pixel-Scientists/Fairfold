// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { keptChanges } from './audit.ts';

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
