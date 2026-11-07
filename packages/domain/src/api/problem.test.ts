// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from '../platform/messages.ts';
import { idempotencyProblems, ProblemError, problemSchema } from './problem.ts';

const base = { title: 'Bad Request', status: 400, detail: 'Check it.', requestId: 'req-1' };

describe('problemSchema', () => {
  it('takes about:blank and the two idempotency problems', () => {
    expect(problemSchema.safeParse({ ...base, type: 'about:blank' }).success).toBe(true);
    for (const { type, status, title, detail } of Object.values(idempotencyProblems)) {
      const problem = { type, status, title, detail, requestId: 'req-1' };
      expect(problemSchema.parse(problem)).toEqual(problem);
    }
  });

  it('refuses any other type, so an unknown problem reads as a generic failure', () => {
    for (const type of ['/problems/other', 'https://example.org/problems/x', '', undefined]) {
      expect(problemSchema.safeParse({ ...base, type }).success, String(type)).toBe(false);
    }
  });
});

describe('idempotencyProblems', () => {
  it('are conflicts with relative types and the catalogue words, as ADR 0028 decides', () => {
    expect(idempotencyProblems).toEqual({
      reused: {
        type: '/problems/idempotency-key-reused',
        status: 409,
        title: messages.keyReusedTitle,
        detail: messages.keyReused,
      },
      inProgress: {
        type: '/problems/idempotency-key-in-progress',
        status: 409,
        title: messages.keyInProgressTitle,
        detail: messages.keyInProgress,
        retryAfterSeconds: 5,
      },
    });
  });

  it('say what happened and what to do, without apologising', () => {
    for (const { title, detail } of Object.values(idempotencyProblems)) {
      expect(detail).toMatch(/^[A-Z][^.]*\. [A-Z].*\.$/);
      expect(`${title} ${detail}`).not.toMatch(/sorry|apolog/i);
    }
  });
});

describe('ProblemError', () => {
  it('defaults to about:blank with no key', () => {
    const error = new ProblemError(400, messages.fixFields);
    expect(error).toMatchObject({ type: 'about:blank', idempotencyKey: null, requestId: null });
  });
});
