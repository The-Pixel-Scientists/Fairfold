// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Errors as problem details (RFC 9457, ADR 0004): the shape every API error
// has, and the error the apps receive from call().

import { z } from 'zod';

import type { FieldProblem } from '../platform/messages.ts';

export const fieldProblemSchema = z.object({
  /** Where the problem is, such as `body.email`, `query.page` or `params.id`. */
  field: z.string(),
  message: z.string(),
});

export const problemSchema = z.object({
  type: z.literal('about:blank'),
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
  readonly detail: string;
  readonly requestId: string | null;
  readonly errors: readonly FieldProblem[];

  constructor(
    status: number,
    detail: string,
    options: { requestId?: string; errors?: readonly FieldProblem[] } = {},
  ) {
    super(detail);
    this.name = 'ProblemError';
    this.status = status;
    this.detail = detail;
    this.requestId = options.requestId ?? null;
    this.errors = options.errors ?? [];
  }
}
