// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console search request and its answers (ADR 0025). The term travels in
// the request body only, and comes back in no response, problem or audit
// value. Each audience has its own response, so a handler cannot send staff
// results to a reviewer: reviewers get only the kinds they reach under
// `assigned_review`, and blind reviewers only an application's reference.

import { z } from 'zod';

import { idSchema } from '../../id.ts';
import { messages } from '../messages.ts';
import { moduleIds, moduleSchema } from '../modules.ts';
import { reviewerKinds, type SearchAudience } from './provider.ts';
import { searchTermSchema } from './term.ts';

/** Results per module in a response. The server asks each provider for one more, to set `more`. */
export const SEARCH_GROUP_LIMIT = 10;

export const searchRequestSchema = z.strictObject({
  term: searchTermSchema,
  /** Only these modules; every module the caller may search when left out. */
  modules: z.array(moduleSchema).min(1).max(moduleIds.length).optional(),
});

export type SearchRequestBody = z.input<typeof searchRequestSchema>;

const kindSchema = z.string().regex(/^[a-z]+\.[a-z][a-z_]*$/);
const labelSchema = z.string().min(1).max(200);
const reviewerKindSchema = z.enum(reviewerKinds);

const staffResultSchema = z.strictObject({ kind: kindSchema, id: idSchema, label: labelSchema });

const reviewerResultSchema = z.strictObject({
  kind: reviewerKindSchema,
  id: idSchema,
  label: labelSchema,
});

/** An application's reference names nobody: capital letters, digits and hyphens only. */
const blindResultSchema = z.strictObject({
  kind: reviewerKindSchema,
  id: idSchema,
  reference: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,23}$/),
});

function groupSchema<M extends z.ZodType<string>, R extends z.ZodType>(module: M, result: R) {
  return z.strictObject({
    module,
    results: z.array(result).max(SEARCH_GROUP_LIMIT),
    /** More results matched than the group holds. */
    more: z.boolean(),
  });
}

/** Each staff result's kind belongs to its group's module. */
const staffGroupSchema = groupSchema(moduleSchema, staffResultSchema).refine(
  (group) => group.results.every((result) => result.kind.startsWith(`${group.module}.`)),
  { error: messages.notValid },
);

function responseSchema<A extends SearchAudience, G extends z.ZodType>(audience: A, group: G) {
  return z.strictObject({
    audience: z.literal(audience),
    groups: z.array(group).max(moduleIds.length),
  });
}

const reviewerModule = z.literal('grants');

/** The answer for each audience; the server answers the most restrictive that applies to the caller. */
export const searchResponseSchemas = {
  staff: responseSchema('staff', staffGroupSchema),
  reviewer: responseSchema('reviewer', groupSchema(reviewerModule, reviewerResultSchema)),
  blind_reviewer: responseSchema('blind_reviewer', groupSchema(reviewerModule, blindResultSchema)),
} as const satisfies Record<SearchAudience, z.ZodType>;

export const searchResponseSchema = z.discriminatedUnion('audience', [
  searchResponseSchemas.staff,
  searchResponseSchemas.reviewer,
  searchResponseSchemas.blind_reviewer,
]);

export type SearchResponse = z.output<typeof searchResponseSchema>;
