// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineAuditActions } from '../audit.ts';
import {
  checkSearchProvider,
  defineSearchProvider,
  searchableFields,
  searchAudiences,
  type SearchAudience,
  type SearchField,
  type SearchFunction,
  type SearchProvider,
  type SearchRequest,
} from './provider.ts';

defineAuditActions('party', ['party.person.found']);

const person = {
  module: 'party',
  kind: 'party.person',
  permission: 'party.records.read',
  scopes: ['tenant'],
  audiences: ['staff'],
  fields: [{ id: 'match_name', sensitivity: 'personal', audiences: ['staff'] }],
  label: 'personal',
  readAction: 'party.person.found',
} as const satisfies SearchProvider;

const assigned = {
  module: 'grants',
  kind: 'grants.application',
  permission: 'grants.reviews.score',
  scopes: ['assigned_review'],
  audiences: ['reviewer', 'blind_reviewer'],
  fields: [
    { id: 'reference', sensitivity: 'internal', audiences: ['reviewer', 'blind_reviewer'] },
    { id: 'organisation_name', sensitivity: 'internal', audiences: ['reviewer'], identity: true },
  ],
  label: 'internal',
} as const satisfies SearchProvider;

/** A provider with one field each audience may or may not see, past the checks a define would make. */
const mixed = {
  module: 'grants',
  kind: 'grants.application',
  permission: 'grants.reviews.score',
  scopes: ['assigned_review'],
  audiences: ['staff', 'reviewer', 'blind_reviewer'],
  fields: [
    {
      id: 'reference',
      sensitivity: 'internal',
      audiences: ['staff', 'reviewer', 'blind_reviewer'],
    },
    { id: 'staff_note', sensitivity: 'internal', audiences: ['staff'] },
    {
      id: 'applicant_name',
      sensitivity: 'personal',
      audiences: ['staff', 'reviewer', 'blind_reviewer'],
      identity: true,
    },
    {
      id: 'applicant_email',
      sensitivity: 'personal',
      audiences: ['staff', 'reviewer', 'blind_reviewer'],
    },
    { id: 'blind_only', sensitivity: 'internal', audiences: ['blind_reviewer'] },
    {
      id: 'ethnicity',
      sensitivity: 'special_category',
      audiences: ['staff', 'reviewer', 'blind_reviewer'],
    },
    {
      id: 'f_summary',
      sensitivity: 'internal',
      audiences: ['staff', 'reviewer', 'blind_reviewer'],
      answer: true,
    },
    { id: 'f_income', sensitivity: 'personal', audiences: 'aggregate_only' },
  ],
  label: 'internal',
} as unknown as SearchProvider;

const visible: Record<SearchAudience, string[]> = {
  staff: ['reference', 'staff_note', 'applicant_name', 'applicant_email'],
  reviewer: ['reference', 'applicant_name', 'applicant_email'],
  blind_reviewer: ['reference'],
};

function withField(field: Partial<SearchField>): SearchProvider {
  return { ...person, fields: [{ ...person.fields[0], ...field }] };
}

function changed(change: Record<string, unknown>): SearchProvider {
  return { ...person, ...change };
}

describe('defineSearchProvider', () => {
  it('returns a provider that keeps every rule unchanged', () => {
    expect(defineSearchProvider(person)).toBe(person);
    expect(defineSearchProvider(assigned)).toBe(assigned);
  });

  it.each([
    [
      'a kind of another module',
      changed({ kind: 'grants.person' }),
      'The kind grants.person must be party.<entity> in lower case.',
    ],
    [
      'a portal permission',
      changed({ permission: 'party.profile.manage' }),
      'party.profile.manage is not a console permission.',
    ],
    [
      'a scope the permission lacks',
      changed({ scopes: ['assigned_review'] }),
      'The scopes must be among those of party.records.read: tenant.',
    ],
    [
      'the applicant',
      changed({ audiences: ['applicant'] }),
      'A provider serves staff, reviewer or blind_reviewer, each once.',
    ],
    [
      'a staff kind for reviewers',
      changed({ audiences: ['reviewer'] }),
      'A provider for reviewers returns grants.application under assigned_review only.',
    ],
    [
      'no fields',
      changed({ fields: [] }),
      'A provider matches on one or more fields, each with its own lower case id.',
    ],
    [
      'a special category field',
      withField({ sensitivity: 'special_category' }),
      'The field match_name is special category data, which is never searchable.',
    ],
    [
      'a form answer',
      withField({ id: 'f_name', answer: true }),
      'The field f_name is a form answer, which is not searchable.',
    ],
    [
      'an aggregate-only answer',
      withField({ id: 'f_income', audiences: 'aggregate_only' }),
      'The field f_income is aggregate only, so nobody may match on it.',
    ],
    [
      'a personal field with no read action',
      changed({ readAction: undefined }),
      'A personal label or field needs a read action, which comes from the party audit actions.',
    ],
    [
      'people found by an internal field, with no read action',
      changed({
        fields: [{ id: 'reference', sensitivity: 'internal', audiences: ['staff'] }],
        readAction: undefined,
      }),
      'A personal label or field needs a read action, which comes from the party audit actions.',
    ],
    [
      'a label built from special category data',
      changed({ label: 'special_category' }),
      'The label is built from public, internal or personal data only.',
    ],
    [
      'a personal field for blind reviewers',
      withField({ id: 'applicant_email', audiences: ['reviewer', 'blind_reviewer'] }),
      'The field applicant_email is personal data, so blind reviewers may not match on it.',
    ],
    [
      'a field for blind reviewers that reviewers may not see',
      withField({ sensitivity: 'internal', audiences: ['staff', 'blind_reviewer'] }),
      'The field match_name lists blind_reviewer, so it must list reviewer too.',
    ],
    [
      'a read action of another module',
      changed({ readAction: 'platform.tenant.created' }),
      'A personal label or field needs a read action, which comes from the party audit actions.',
    ],
    [
      'a read action in no list',
      changed({ readAction: 'party.person.unlisted' }),
      'A personal label or field needs a read action, which comes from the party audit actions.',
    ],
  ])('refuses %s', (_name, provider, problem) => {
    expect(checkSearchProvider(provider)).toEqual([problem]);
    expect(() => defineSearchProvider(provider)).toThrow(problem);
  });

  it('refuses an identity field for blind reviewers', () => {
    const fields = [{ ...assigned.fields[1], audiences: ['reviewer', 'blind_reviewer'] }];
    expect(checkSearchProvider({ ...assigned, fields } as SearchProvider)).toEqual([
      'The field organisation_name identifies an applicant, so blind reviewers may not match on it.',
    ]);
  });

  it('refuses a reviewer provider that reaches the whole tenant', () => {
    const provider = { ...assigned, permission: 'grants.applications.read', scopes: ['tenant'] };
    expect(checkSearchProvider(provider as SearchProvider)).toEqual([
      'A provider for reviewers returns grants.application under assigned_review only.',
    ]);
  });
});

describe('searchableFields', () => {
  it.each(searchAudiences)('gives %s only the fields it may see', (audience) => {
    expect(searchableFields(mixed, audience)).toEqual(visible[audience]);
  });

  it('gives nothing to an audience the provider does not serve', () => {
    expect(searchableFields(person, 'reviewer')).toEqual([]);
    expect(searchableFields(assigned, 'staff')).toEqual([]);
  });

  it('never lets a term found only in a hidden field match', () => {
    const term = 'Zebedee';
    const record: Record<string, string> = {
      reference: 'GR-0001',
      staff_note: 'Zebedee',
      applicant_name: 'Zebedee',
      applicant_email: 'Zebedee@example.org',
      blind_only: 'Zebedee',
      ethnicity: 'Zebedee',
      f_summary: 'Zebedee',
      f_income: 'Zebedee',
    };
    const matches = (audience: SearchAudience) =>
      searchableFields(mixed, audience).some((field) => record[field]?.includes(term));
    expect(matches('staff')).toBe(true);
    expect(matches('reviewer')).toBe(true);
    expect(matches('blind_reviewer')).toBe(false);
    delete record['applicant_name'];
    expect(matches('reviewer')).toBe(true);
    delete record['applicant_email'];
    expect(matches('reviewer')).toBe(false);
  });
});

describe('a provider search', () => {
  it('takes a term, an audience and a limit, and nothing about the caller', () => {
    expectTypeOf<keyof SearchRequest>().toEqualTypeOf<'term' | 'audience' | 'limit'>();
    expectTypeOf<Parameters<SearchFunction>>().toEqualTypeOf<[request: SearchRequest]>();
  });
});
