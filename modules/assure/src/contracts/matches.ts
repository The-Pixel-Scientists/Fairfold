// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Possible sanctions matches and their decisions (ADR 0031, rule 9, UK GDPR
// Article 22). A match is only ever raised for a person to review: nothing
// here rejects, holds, blocks or pays, and there is no automatic, default
// or threshold-based outcome. Each decision is a named member's, after
// signing in again in the last 5 minutes; the member comes from the session.
// Decisions are append-only, with no route to change or remove one, and the
// newest is the match's state. They hold codes, never free text.
//
// - `assure.screening.read` lists matches by ids and codes, and reads one
//   with the listed entry and the screened name side by side, a sensitive
//   read (`assure.screening_match.viewed`).
// - `assure.screening.decide` records a decision
//   (`assure.screening_match.decided`). A match on an officer who is not
//   linked to a person can only be decided `not_a_match`: 409 otherwise.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { assureMessages, says } from './messages.ts';
import { choice, cursorSchema, dateSchema, timestampSchema } from './schemas.ts';
import { listVersionSchema } from './screening.ts';

export const matchOutcomes = ['not_a_match', 'needs_information', 'confirmed'] as const;

export type MatchOutcome = (typeof matchOutcomes)[number];

export const matchStatuses = ['open', ...matchOutcomes] as const;

/** The reasons each outcome may give. */
export const matchReasons = {
  not_a_match: [
    'different_name',
    'different_date_of_birth',
    'different_nationality',
    'different_country',
    'different_entity_kind',
  ],
  needs_information: ['identity_unclear', 'details_missing'],
  confirmed: ['identity_confirmed'],
} as const satisfies Record<MatchOutcome, readonly string[]>;

export const matchReasonCodes = Object.values(matchReasons).flat() as [
  MatchReason,
  ...MatchReason[],
];

export type MatchReason = (typeof matchReasons)[MatchOutcome][number];

/** Where the screened name came from: a party record, an organisation's registered name, or an officer. */
export const nameSources = ['party', 'registered_name', 'officer'] as const;

export const entryKinds = ['individual', 'entity', 'ship'] as const;

/**
 * A match in the queue: ids and codes, no names. `partyId` is the party
 * screened; `subjectPartyId` is whose name matched, null for an officer
 * not linked to a person.
 */
export const matchSummarySchema = z.strictObject({
  id: idSchema,
  runId: idSchema,
  partyId: idSchema,
  subjectPartyId: idSchema.nullable(),
  nameSource: z.enum(nameSources),
  entryKind: z.enum(entryKinds),
  similarity: z.number().min(0).max(1),
  status: z.enum(matchStatuses),
  raisedAt: timestampSchema,
});

export const matchPageSchema = z.strictObject({
  matches: z.array(matchSummarySchema),
  nextCursor: cursorSchema.nullable(),
});

export const matchDecisionSchema = z.strictObject({
  id: idSchema,
  outcome: z.enum(matchOutcomes),
  reason: z.enum(matchReasonCodes),
  decidedAt: timestampSchema,
  /** The deciding membership. */
  decidedBy: idSchema,
});

export type MatchDecision = z.infer<typeof matchDecisionSchema>;

/** A published date of birth, which may be a year or a month only. */
const partialDate = z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/);

/**
 * One match with its evidence, copied when it was raised: the name
 * screened, and the listed designation's identifying details as published.
 * Never a statement of reasons or other free text. Decisions oldest first.
 */
export const matchSchema = matchSummarySchema.extend({
  screenedName: z.string(),
  officerId: idSchema.nullable(),
  entry: z.strictObject({
    designationId: z.string(),
    name: z.string(),
    regime: z.string(),
    designatedOn: dateSchema.nullable(),
    datesOfBirth: z.array(partialDate),
    nationalities: z.array(z.string()),
    country: z.string().nullable(),
  }),
  list: listVersionSchema.omit({ lastCheckedAt: true }),
  decisions: z.array(matchDecisionSchema),
});

export type Match = z.infer<typeof matchSchema>;

/** Oldest first, so the longest waiting are seen first. */
export const matchQuerySchema = z.strictObject({
  status: choice(matchStatuses, assureMessages.matchStatus).optional(),
  partyId: idSchema.optional(),
  /** Raised before this date. */
  raisedBefore: dateSchema.optional(),
  cursor: cursorSchema.optional(),
});

export type MatchQuery = z.infer<typeof matchQuerySchema>;

/** An outcome and a reason that fits it. Nothing else: no note, and no member. */
export const matchDecisionInputSchema = z
  .strictObject({
    outcome: choice(matchOutcomes, assureMessages.matchOutcome),
    reason: choice(matchReasonCodes, assureMessages.matchReason),
  })
  .refine(({ outcome, reason }) => (matchReasons[outcome] as readonly string[]).includes(reason), {
    ...says(assureMessages.reasonForOutcome),
    path: ['reason'],
  });

export type MatchDecisionInput = z.infer<typeof matchDecisionInputSchema>;

const read = {
  audience: 'console',
  module: 'assure',
  scope: 'tenant',
  permission: 'assure.screening.read',
} as const;

const match = { params: z.strictObject({ matchId: idSchema }) } as const;

export const listScreeningMatches = defineRoute({
  ...read,
  method: 'GET',
  path: '/console/screening-matches',
  summary: 'List possible sanctions matches by status, party and age, a page at a time',
  query: matchQuerySchema,
  responses: { 200: matchPageSchema },
});

export const getScreeningMatch = defineRoute({
  ...read,
  ...match,
  method: 'GET',
  path: '/console/screening-matches/:matchId',
  summary: 'Read a possible match beside the listed entry, with its decisions',
  responses: { 200: matchSchema },
});

export const decideScreeningMatch = defineRoute({
  ...read,
  ...match,
  permission: 'assure.screening.decide',
  stepUp: true,
  method: 'POST',
  idempotent: true,
  path: '/console/screening-matches/:matchId/decisions',
  summary: 'Decide a possible match, with a reason from the list',
  body: matchDecisionInputSchema,
  responses: { 201: matchDecisionSchema },
});

export const matchRoutes = {
  listScreeningMatches,
  getScreeningMatch,
  decideScreeningMatch,
} as const;
