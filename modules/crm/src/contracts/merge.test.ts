// SPDX-License-Identifier: AGPL-3.0-or-later

import { mergeConflicts } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { scoreBand } from './duplicates.ts';
import {
  checkPreviewToken,
  makePreviewToken,
  mergeConfirmInputSchema,
  PREVIEW_TOKEN_LIFETIME,
  previewBasisText,
  previewTokenMatches,
  type PreviewBasis,
  type PreviewTokenSigner,
} from './merge.ts';
import { crmMessages, mergeConflictMessages } from './messages.ts';

const loserId = '0190f0a0-0000-7000-8000-000000000001';
const survivorId = '0190f0a0-0000-7000-8000-000000000002';
const linkA = '0190f0a0-0000-7000-8000-00000000000a';
const linkB = '0190f0a0-0000-7000-8000-00000000000b';
const token = `1794830400.${'a'.repeat(43)}`;

const basis: PreviewBasis = {
  loserId,
  survivorId,
  kind: 'organisation',
  fields: [
    { fieldId: 'organisation.name', loser: 'Northfield Trust', survivor: 'Northfield Trust Ltd' },
    { fieldId: 'organisation.website', loser: null, survivor: 'https://example.org/' },
  ],
  conflicts: [],
  counts: { party: { 'party.relationship': 2 }, grants: { 'grants.application': 3 } },
  linkRule: 'choose',
  links: [{ relationshipId: linkA }, { relationshipId: linkB }],
};

describe('the merge preview token', () => {
  it('covers the same preview whatever order its lists come in', () => {
    const reordered: PreviewBasis = {
      ...basis,
      fields: [...basis.fields].reverse(),
      counts: { grants: { 'grants.application': 3 }, party: { 'party.relationship': 2 } },
      links: [...basis.links].reverse(),
    };
    expect(previewBasisText(reordered)).toBe(previewBasisText(basis));
  });

  it.each<[string, Partial<PreviewBasis>]>([
    ['swapped parties', { loserId: survivorId, survivorId: loserId }],
    ['a changed value', { fields: [{ fieldId: 'organisation.name', loser: 'X', survivor: 'Y' }] }],
    ['a new conflict', { conflicts: ['module_refused'] }],
    ['a changed count', { counts: { grants: { 'grants.application': 4 } } }],
    ['a different link rule', { linkRule: 'automatic' }],
    ['a link gone', { links: [{ relationshipId: linkA }] }],
  ])('changes with %s', (_, change) => {
    expect(previewBasisText({ ...basis, ...change })).not.toBe(previewBasisText(basis));
  });

  it('matches only the same token', () => {
    const token = 'a'.repeat(43);
    expect(previewTokenMatches(token, token)).toBe(true);
    expect(previewTokenMatches(token, `${'a'.repeat(42)}b`)).toBe(false);
    expect(previewTokenMatches(token, token.slice(1))).toBe(false);
    expect(previewTokenMatches('', '')).toBe(false);
  });
});

describe('the merge preview token check', () => {
  /** A stand-in for the server's HMAC: 43 base64url characters that depend on the whole text. */
  const sign: PreviewTokenSigner = (text) => {
    let hash = 2166136261;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash.toString(36).padStart(43, '0');
  };
  const owner = {
    tenantId: '0190f0a0-0000-7000-8000-0000000000e1',
    membershipId: '0190f0a0-0000-7000-8000-0000000000c1',
  };
  const issuedAt = 1794830400;
  const issued = makePreviewToken(issuedAt, owner, basis, sign);
  const check = (sent: string, now: number, by = owner, preview = basis) =>
    checkPreviewToken(sent, now, by, preview, sign);

  it('is a well-formed token that accepts the same member within the step-up window', () => {
    expect(mergeConfirmInputSchema.shape.token.safeParse(issued).success).toBe(true);
    expect(check(issued, issuedAt)).toBe(true);
    expect(check(issued, issuedAt + PREVIEW_TOKEN_LIFETIME)).toBe(true);
  });

  it('refuses a token older than five minutes or issued later than now', () => {
    expect(PREVIEW_TOKEN_LIFETIME).toBe(300);
    expect(check(issued, issuedAt + PREVIEW_TOKEN_LIFETIME + 1)).toBe(false);
    expect(check(issued, issuedAt - 1)).toBe(false);
  });

  it('refuses a token made for another member or tenant', () => {
    expect(check(issued, issuedAt, { ...owner, membershipId: survivorId })).toBe(false);
    expect(check(issued, issuedAt, { ...owner, tenantId: survivorId })).toBe(false);
  });

  it('refuses a token for another preview, or with its issue time changed', () => {
    expect(check(issued, issuedAt, owner, { ...basis, conflicts: ['module_refused'] })).toBe(false);
    const later = issued.replace(String(issuedAt), String(issuedAt + 60));
    expect(check(later, issuedAt + 60)).toBe(false);
    expect(check(issued.split('.')[1] ?? '', issuedAt)).toBe(false);
  });
});

describe('merge confirm input', () => {
  const input = { loserId, survivorId, kind: 'organisation', carryOver: [linkA], token };

  it('holds only the ids, the links to carry over and the token', () => {
    expect(mergeConfirmInputSchema.parse(input)).toEqual(input);
    expect(mergeConfirmInputSchema.parse({ ...input, carryOver: undefined })).toEqual({
      ...input,
      carryOver: [],
    });
    for (const extra of ['decidedBy', 'membershipId', 'fields', 'force']) {
      expect(mergeConfirmInputSchema.safeParse({ ...input, [extra]: 'x' }).success).toBe(false);
    }
  });

  it('refuses a confirm without a token, with a malformed one, or of a record into itself', () => {
    expect(mergeConfirmInputSchema.safeParse({ ...input, token: undefined }).success).toBe(false);
    const messages = (value: unknown) =>
      mergeConfirmInputSchema.safeParse(value).error?.issues.map((issue) => issue.message);
    expect(messages({ ...input, token: 'not a token' })).toEqual([crmMessages.previewToken]);
    expect(messages({ ...input, survivorId: loserId })).toEqual([crmMessages.samePartyTwice]);
    expect(mergeConfirmInputSchema.safeParse({ ...input, carryOver: [linkA, linkA] }).success).toBe(
      false,
    );
  });

  it("has a message for each of party's conflicts", () => {
    expect(Object.keys(mergeConflictMessages).sort()).toEqual([...mergeConflicts].sort());
  });
});

describe('duplicate score bands', () => {
  it('take the strongest signal', () => {
    expect(scoreBand(['name'])).toBe('low');
    expect(scoreBand(['name', 'name_and_postcode'])).toBe('medium');
    expect(scoreBand(['name', 'verified_identifier'])).toBe('high');
    expect(scoreBand(['email'])).toBe('high');
  });
});
