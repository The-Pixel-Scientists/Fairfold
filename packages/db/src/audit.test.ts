// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type Transaction,
} from 'kysely';
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

  it("keeps a logo's SHA-256 digest, and nothing else for it", () => {
    const sha256 = 'ab'.repeat(32);
    const logo = (after: unknown) => keptChanges({ 'app.tenant_theme.logo': { after } });
    expect(logo(sha256)).toEqual({ 'app.tenant_theme.logo': { after: sha256 } });
    expect(logo(Buffer.from('png'))).toEqual({ 'app.tenant_theme.logo': {} });
    expect(logo('AB'.repeat(32))).toEqual({ 'app.tenant_theme.logo': {} });
    expect(logo('iVBORw0KGgo=')).toEqual({ 'app.tenant_theme.logo': {} });
  });

  it('keeps changed tokens by path, or the marker for unusable ones', () => {
    const changes = {
      'app.tenant_theme.tokens': { before: { font: null }, after: { font: 'system' } },
    };
    expect(keptChanges(changes)).toEqual(changes);
    const cleared = { 'app.tenant_theme.tokens': { before: 'unusable', after: null } };
    expect(keptChanges(cleared)).toEqual(cleared);
  });

  it.each([
    ['an unknown token path', { 'jane.smith': 'x' }],
    ['a nested value', { font: { name: 'system' } }],
    ['a list', ['system']],
    ['another string', 'system'],
    ['an object with a prototype', Object.create({ font: 'system' }) as object],
  ])('records tokens by their id alone when the value is %s', (_, after) => {
    expect(keptChanges({ 'app.tenant_theme.tokens': { after } })).toEqual({
      'app.tenant_theme.tokens': {},
    });
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

  it('writes the subject party id, or null when there is none', async () => {
    const sent: CompiledQuery[] = [];
    const db = new Kysely<unknown>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
      log: (event) => {
        sent.push(event.query);
      },
    });
    const subjectPartyId = '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09';
    const row = {
      requestId: 'r',
      actorKind: 'system',
      actorId: null,
      action: 'party.person.updated',
      entityType: 'party.person',
      entityId: subjectPartyId,
      changes: {},
    } as const;
    const trx = db as unknown as Transaction<unknown>;
    await insertAuditEvent(trx, { ...row, subjectPartyId });
    await insertAuditEvent(trx, row);
    expect(
      sent.map(({ sql, parameters }) => [sql.includes('subject_party_id'), parameters.at(-1)]),
    ).toEqual([
      [true, subjectPartyId],
      [true, null],
    ]);
  });
});
