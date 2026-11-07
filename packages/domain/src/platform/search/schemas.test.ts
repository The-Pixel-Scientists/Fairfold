// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { requestProblems } from '../../api/schema-rules.ts';
import { SEARCH_GROUP_LIMIT, searchRequestSchema, searchResponseSchema } from './schemas.ts';

const id = '0190c3a2-7b1e-7c4d-8e2f-1a2b3c4d5e6f';

describe('searchRequestSchema', () => {
  it('takes a term and an optional module filter, and nothing else', () => {
    expect(searchRequestSchema.parse({ term: 'Smith', modules: ['party', 'crm'] })).toEqual({
      term: 'Smith',
      modules: ['party', 'crm'],
    });
    for (const extra of [{ tenantId: id }, { audience: 'staff' }, { membershipId: id }]) {
      expect(searchRequestSchema.safeParse({ term: 'Smith', ...extra }).success).toBe(false);
    }
    expect(searchRequestSchema.safeParse({ term: 'Smith', modules: ['billing'] }).success).toBe(
      false,
    );
  });

  it('keeps the schema rules', () => {
    expect(requestProblems('/console/search', 'body', searchRequestSchema)).toEqual([]);
  });
});

describe('searchResponseSchema', () => {
  const staff = {
    audience: 'staff',
    groups: [
      { module: 'party', results: [{ kind: 'party.person', id, label: 'Al Smith' }], more: false },
    ],
  };
  const blind = {
    audience: 'blind_reviewer',
    groups: [
      {
        module: 'grants',
        results: [{ kind: 'grants.application', id, reference: 'GR-0001' }],
        more: true,
      },
    ],
  };

  function withResult(response: typeof staff | typeof blind, result: object) {
    const [group] = response.groups;
    return { ...response, groups: [{ ...group, results: [result] }] };
  }

  it('takes results grouped by module for each audience', () => {
    expect(searchResponseSchema.parse(staff)).toEqual(staff);
    expect(searchResponseSchema.parse(blind)).toEqual(blind);
    const reviewer = withResult(
      { ...blind, audience: 'reviewer' },
      {
        kind: 'grants.application',
        id,
        label: 'Community garden',
      },
    );
    expect(searchResponseSchema.parse(reviewer)).toEqual(reviewer);
  });

  it('refuses a name in a blind review result', () => {
    const [result] = blind.groups[0]?.results ?? [];
    for (const named of [
      { ...result, name: 'Al Smith' },
      { ...result, label: 'Al Smith' },
      { ...result, reference: 'Al Smith' },
    ]) {
      expect(searchResponseSchema.safeParse(withResult(blind, named)).success).toBe(false);
    }
  });

  it('refuses a staff-only kind in a reviewer response', () => {
    const reviewer = {
      audience: 'reviewer',
      groups: [
        {
          module: 'party',
          results: [{ kind: 'party.person', id, label: 'Al Smith' }],
          more: false,
        },
      ],
    };
    expect(searchResponseSchema.safeParse(reviewer).success).toBe(false);
  });

  it('refuses a result of another module, and a group over its cap', () => {
    expect(
      searchResponseSchema.safeParse(
        withResult(staff, { kind: 'grants.application', id, label: 'X' }),
      ).success,
    ).toBe(false);
    const [group] = staff.groups;
    const results = Array.from({ length: SEARCH_GROUP_LIMIT + 1 }, () => group?.results[0]);
    expect(
      searchResponseSchema.safeParse({ ...staff, groups: [{ ...group, results }] }).success,
    ).toBe(false);
  });

  it('has no field that carries the term back', () => {
    const keys = JSON.stringify(z.toJSONSchema(searchResponseSchema, { io: 'output' }));
    expect(keys).not.toMatch(/"(?:term|query|search)"/);
  });
});
