// SPDX-License-Identifier: AGPL-3.0-or-later

import { idempotencyProblems, ProblemError } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { publicFormProblems } from '../contracts/index.ts';
import { failureOf, fieldProblemsOf, retryKeyOf, wordsFor } from './problems.ts';

const KEY = '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90'; // gitleaks:allow

describe('failureOf', () => {
  it('tells a changed form from a key problem, which is typed', () => {
    expect(failureOf(new ProblemError(409, 'x'))).toBe('form_changed');
    expect(failureOf(new ProblemError(409, 'x', { type: idempotencyProblems.reused.type }))).toBe(
      'other',
    );
  });

  it('tells a refused browser check from refused answers, which name their fields', () => {
    expect(failureOf(new ProblemError(400, 'x'))).toBe('proof_invalid');
    expect(
      failureOf(
        new ProblemError(400, 'x', { errors: [{ field: 'f_name', message: 'Enter text.' }] }),
      ),
    ).toBe('other');
  });
});

describe('wordsFor', () => {
  it('uses the catalogue for the two problems the API words only by status', () => {
    expect(wordsFor(new ProblemError(409, 'Request failed.'))).toBe(
      publicFormProblems.formChanged.detail,
    );
    expect(wordsFor(new ProblemError(400, 'Request failed.'))).toBe(
      publicFormProblems.proofInvalid.detail,
    );
  });

  it('shows any other refusal as it came, and never a raw error', () => {
    expect(
      wordsFor(new ProblemError(429, 'Too many attempts. Wait 30 seconds, then try again.')),
    ).toBe('Too many attempts. Wait 30 seconds, then try again.');
    expect(wordsFor(new Error('boom'))).toBe(
      'Something went wrong. Check your connection and try again.',
    );
  });
});

describe('fieldProblemsOf', () => {
  it('names each refused answer by its question id', () => {
    const error = new ProblemError(400, 'x', {
      errors: [
        { field: 'body.answers.f_name', message: 'Enter text.' },
        { field: 'f_address.postcode', message: 'Enter a postcode.' },
      ],
    });

    expect(fieldProblemsOf(error)).toEqual([
      { field: 'f_name', message: 'Enter text.' },
      { field: 'f_address.postcode', message: 'Enter a postcode.' },
    ]);
  });
});

describe('retryKeyOf', () => {
  it('keeps the key only when the request may not have arrived or is still being handled', () => {
    expect(retryKeyOf(new ProblemError(0, 'x', { idempotencyKey: KEY }))).toBe(KEY);
    expect(retryKeyOf(new ProblemError(503, 'x', { idempotencyKey: KEY }))).toBe(KEY);
    expect(
      retryKeyOf(
        new ProblemError(409, 'x', {
          type: idempotencyProblems.inProgress.type,
          idempotencyKey: KEY,
        }),
      ),
    ).toBe(KEY);
  });

  it('starts a new submission after any answer from the server', () => {
    expect(retryKeyOf(new ProblemError(400, 'x', { idempotencyKey: KEY }))).toBeUndefined();
    expect(
      retryKeyOf(
        new ProblemError(409, 'x', { type: idempotencyProblems.reused.type, idempotencyKey: KEY }),
      ),
    ).toBeUndefined();
    expect(retryKeyOf(new Error('x'))).toBeUndefined();
  });
});
