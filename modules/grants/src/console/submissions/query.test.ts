import { describe, expect, it } from 'vitest';

import { submissionQuerySchema } from '../../contracts/index.ts';
import { callQuery, isFiltered, searchOf, withCursor, withFilter } from './query.ts';

const ROUND = '11111111-2222-4333-8444-555555555555';
const STAGE = '66666666-7777-4888-8999-000000000000';
const PROGRAMME = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('searchOf', () => {
  it('is empty when nothing is chosen', () => {
    expect(searchOf({})).toBe('');
  });

  it('writes each filter in a fixed order, and the page last', () => {
    expect(
      searchOf({
        cursor: 'abc_1',
        late: true,
        status: 'submitted',
        stageId: STAGE,
        roundId: ROUND,
      }),
    ).toBe(`?roundId=${ROUND}&stageId=${STAGE}&status=submitted&late=true&cursor=abc_1`);
  });

  it('writes a late filter of false, which is a filter', () => {
    expect(searchOf({ late: false })).toBe('?late=false');
  });

  it('reads back what it wrote, through the contract', () => {
    const query = { programmeId: PROGRAMME, eligibility: 'stopped', late: false } as const;
    const record = Object.fromEntries(new URLSearchParams(searchOf(query)));
    expect(submissionQuerySchema.parse(record)).toEqual(query);
  });
});

describe('withFilter', () => {
  it('sets a filter and returns to the first page', () => {
    expect(
      withFilter({ status: 'submitted', cursor: 'abc_1' }, { eligibility: 'eligible' }),
    ).toEqual({
      status: 'submitted',
      eligibility: 'eligible',
    });
  });

  it('clears a filter given as undefined', () => {
    expect(withFilter({ status: 'submitted', late: true }, { status: undefined })).toEqual({
      late: true,
    });
  });

  it('clears the round and stage when the programme changes, and the stage when the round does', () => {
    const query = { programmeId: PROGRAMME, roundId: ROUND, stageId: STAGE } as const;
    expect(withFilter(query, { programmeId: undefined })).toEqual({});
    expect(withFilter(query, { roundId: undefined })).toEqual({ programmeId: PROGRAMME });
    expect(withFilter({ roundId: ROUND, stageId: STAGE }, { roundId: ROUND })).toEqual({
      roundId: ROUND,
    });
  });

  it('keeps a stage that is changed on its own', () => {
    expect(withFilter({ roundId: ROUND }, { stageId: STAGE })).toEqual({
      roundId: ROUND,
      stageId: STAGE,
    });
  });

  it('refuses a value the contract would refuse', () => {
    expect(() => withFilter({}, { roundId: 'spring' })).toThrow();
  });
});

describe('withCursor', () => {
  it('sets and removes the page without touching the filters', () => {
    expect(withCursor({ status: 'submitted' }, 'abc_1')).toEqual({
      status: 'submitted',
      cursor: 'abc_1',
    });
    expect(withCursor({ status: 'submitted', cursor: 'abc_1' }, undefined)).toEqual({
      status: 'submitted',
    });
  });
});

describe('isFiltered', () => {
  it('counts a filter and not a page', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ cursor: 'abc_1' })).toBe(false);
    expect(isFiltered({ late: false })).toBe(true);
  });
});

describe('callQuery', () => {
  it('gives the API late as the text it reads', () => {
    expect(callQuery({ status: 'submitted', late: true })).toEqual({
      status: 'submitted',
      late: 'true',
    });
    expect(callQuery({ late: false })).toEqual({ late: 'false' });
    expect(callQuery({ status: 'withdrawn' })).toEqual({ status: 'withdrawn' });
  });
});
