// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { catalogueParams } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { naming, refuse, refuseUnless, topField } from './problems.ts';

const refusing = (message: string) => ({
  safeParse: () => ({
    success: false,
    error: {
      issues: [
        { code: 'custom', message, params: catalogueParams, path: ['title'] },
        { code: 'custom', message: 'Enter a date.', params: catalogueParams, path: ['opensAt'] },
      ],
    },
  }),
});

function thrownBy(action: () => void): ProblemError {
  try {
    action();
  } catch (error) {
    if (error instanceof ProblemError) return error;
    throw error;
  }
  throw new Error('Nothing was thrown.');
}

describe('topField', () => {
  it('names the field without body. and without anything inside it', () => {
    expect(topField('body.title')).toBe('title');
    expect(topField('body.budget.amountMinor')).toBe('budget');
    expect(topField('title')).toBe('title');
  });
});

describe('refuse', () => {
  it('does nothing when there is nothing wrong, and otherwise refuses with the problems', () => {
    expect(() => {
      refuse([]);
    }).not.toThrow();

    const error = thrownBy(() => {
      refuse([{ field: 'body.title', message: 'Enter a title.' }]);
    });

    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ field: 'body.title', message: 'Enter a title.' }]);
  });
});

describe('refuseUnless', () => {
  it('adds what the schema finds beside fields that have no problem yet', () => {
    const error = thrownBy(() => {
      refuseUnless(
        refusing('Enter a title.'),
        {},
        [{ field: 'body.opensAt', message: 'Enter the opening date.' }],
        (field) => (field === 'body.title' ? 0 : 1),
      );
    });

    expect(error.errors).toEqual([
      { field: 'body.title', message: 'Enter a title.' },
      { field: 'body.opensAt', message: 'Enter the opening date.' },
    ]);
  });

  it('leaves out what the schema finds in fields it was told are covered', () => {
    const error = thrownBy(() => {
      refuseUnless(
        refusing('Enter a title.'),
        {},
        [{ field: 'body.opensAtTime', message: 'Enter the opening time.' }],
        () => 0,
        ['body.opensAt'],
      );
    });

    expect(error.errors.map(({ field }) => field)).toEqual(['body.opensAtTime', 'body.title']);
  });

  it('does nothing when the schema finds nothing and nothing was found', () => {
    expect(() => {
      refuseUnless({ safeParse: () => ({ success: true }) }, {}, [], () => 0);
    }).not.toThrow();
  });
});

describe('naming', () => {
  it('renames the field of each problem to the id of its control, keeping the rest', async () => {
    const action = naming(topField, () => {
      throw new ProblemError(400, 'Fix the fields.', {
        requestId: 'req_1',
        errors: [{ field: 'body.budget.amountMinor', message: 'Enter an amount.' }],
      });
    });

    const error = await action().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProblemError);
    expect(error).toMatchObject({
      status: 400,
      detail: 'Fix the fields.',
      requestId: 'req_1',
      errors: [{ field: 'budget', message: 'Enter an amount.' }],
    });
  });

  it('lets any other failure through as it is', async () => {
    const refused = new ProblemError(503, 'The service is busy.');
    const bug = new TypeError('x is undefined');

    expect(await naming(topField, () => Promise.reject(refused))().catch((e: unknown) => e)).toBe(
      refused,
    );
    expect(await naming(topField, () => Promise.reject(bug))().catch((e: unknown) => e)).toBe(bug);
  });
});
