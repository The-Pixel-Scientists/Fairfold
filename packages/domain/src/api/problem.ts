// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Errors as problem details (RFC 9457, ADR 0004): the shape every API error
// has, and the error the apps receive from call().

import { z } from 'zod';

import { messages, type FieldProblem } from '../platform/messages.ts';

/**
 * The problems an idempotent route adds (ADR 0028). Their types are relative
 * to the API's origin, so they name no host. Their words are fixed: neither
 * ever repeats the key or a request value.
 */
export const idempotencyProblems = {
  /** The same key, member and route with a different request. */
  reused: {
    type: '/problems/idempotency-key-reused',
    status: 409,
    title: messages.keyReusedTitle,
    detail: messages.keyReused,
  },
  /** The reservation waited this long for another request with the key. */
  inProgress: {
    type: '/problems/idempotency-key-in-progress',
    status: 409,
    title: messages.keyInProgressTitle,
    detail: messages.keyInProgress,
    retryAfterSeconds: 5,
  },
} as const;

export const problemTypes = [
  'about:blank',
  idempotencyProblems.reused.type,
  idempotencyProblems.inProgress.type,
] as const;

export type ProblemType = (typeof problemTypes)[number];

export const fieldProblemSchema = z.object({
  /** Where the problem is, such as `body.email`, `query.page` or `params.id`. */
  field: z.string(),
  message: z.string(),
});

export const problemSchema = z.object({
  type: z.enum(problemTypes),
  title: z.string(),
  status: z.int(),
  detail: z.string(),
  /** Quote this when asking for help. */
  requestId: z.string(),
  errors: z.array(fieldProblemSchema).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

/** What went wrong with a call, in words to show. */
export class ProblemError extends Error {
  /** The HTTP status, 400 when the input failed validation before sending, 0 when the API could not be reached. */
  readonly status: number;
  /** Tells apart problems that share a status, such as the two in idempotencyProblems. */
  readonly type: ProblemType;
  readonly detail: string;
  readonly requestId: string | null;
  readonly errors: readonly FieldProblem[];
  /**
   * The idempotency key sent, or null. To try the same submission again,
   * pass it back as `idempotencyKey`; never after the reused-key problem.
   */
  readonly idempotencyKey: string | null;

  constructor(
    status: number,
    detail: string,
    options: {
      type?: ProblemType;
      requestId?: string;
      errors?: readonly FieldProblem[];
      idempotencyKey?: string | null;
    } = {},
  ) {
    super(detail);
    this.name = 'ProblemError';
    this.status = status;
    this.type = options.type ?? 'about:blank';
    this.detail = detail;
    this.requestId = options.requestId ?? null;
    this.errors = options.errors ?? [];
    this.idempotencyKey = options.idempotencyKey ?? null;
  }
}
