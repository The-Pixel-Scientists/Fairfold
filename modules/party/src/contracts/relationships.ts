// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Relationships between parties (ADR 0017, ADR 0025): a type, the kind of
// party at each end, and optional start and end dates. Rows are never
// deleted; ending one sets its end date. The acting member comes from the
// session.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import {
  partyKindSchema,
  relationshipTypeRules,
  relationshipTypeSchema,
  type PartyKind,
  type RelationshipType,
} from './lists.ts';
import { partyMessages, type PartyMessage } from './messages.ts';

/** A relationship as the server is about to write it. Dates are ISO dates, such as `2026-11-12`. */
export interface RelationshipLink {
  readonly type: RelationshipType;
  readonly fromKind: PartyKind;
  readonly toKind: PartyKind;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

/** What is wrong with a relationship, or nothing: a type used with the wrong kinds, or an end before the start. */
export function relationshipProblems(link: RelationshipLink): PartyMessage[] {
  const rule = relationshipTypeRules[link.type];
  const problems: PartyMessage[] = [];
  if (rule.from !== link.fromKind || rule.to !== link.toKind) {
    problems.push(partyMessages.relationshipKinds);
  }
  if (link.startsOn !== null && link.endsOn !== null && link.endsOn < link.startsOn) {
    problems.push(partyMessages.relationshipDates);
  }
  return problems;
}

/**
 * Staff add a person to the organisation in the path. Adding one that is
 * already current answers the existing relationship.
 */
export const relationshipInputSchema = z.strictObject({
  type: relationshipTypeSchema,
  personId: idSchema,
  startsOn: z.iso.date().optional(),
});

export type RelationshipInput = z.infer<typeof relationshipInputSchema>;

export const endRelationshipSchema = z.strictObject({ endsOn: z.iso.date() });

export type EndRelationship = z.infer<typeof endRelationshipSchema>;

const relatedPartySchema = z.strictObject({
  id: idSchema,
  kind: partyKindSchema,
  /** An organisation's name, or a person's full name; null for a person who has not given one. */
  name: z.string().nullable(),
});

/** A relationship as staff see it. */
export const consoleRelationshipSchema = z.strictObject({
  id: idSchema,
  type: relationshipTypeSchema,
  from: relatedPartySchema,
  to: relatedPartySchema,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
});

export type ConsoleRelationship = z.infer<typeof consoleRelationshipSchema>;
