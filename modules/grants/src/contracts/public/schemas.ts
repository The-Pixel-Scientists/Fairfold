// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What anyone on the internet reads about a tenant's open rounds before
// signing in (E6, ADR 0035). Every field here is published, so the list is
// short and each schema is strict: `grants.public_open_rounds(slug)` returns
// these columns and nothing else. They are a strict subset of what a
// signed-in applicant reads (`openRoundSchema`), plus the opening time and
// the eligibility summary, which that applicant reads in the round's form.
//
// Never here: programme or tenant ids, the programme's description, the
// round's budget, status, stages, rubric, email templates or late policy,
// the form beyond its eligibility questions, counts, config history, and
// any member, user, party, reviewer or decision data.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { amountSchema } from '../programme/inputs.ts';
import { programmeMessages, says } from '../programme/messages.ts';

/** The most open rounds the list holds. There is no paging in V1. */
export const MAX_PUBLIC_ROUNDS = 100;

/** The most eligibility questions a round's summary holds, in form order. */
export const MAX_PUBLIC_ELIGIBILITY_ITEMS = 50;

/** Capped at the limit of the field it is copied from. */
const text = (max: number) => z.string().min(1).max(max);

/** An IANA time zone name, such as `Europe/London`, as tenant settings hold it. */
const timeZone = z.string().regex(/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/);

/**
 * One eligibility question of the round's latest published form version,
 * as the form shows it to applicants: its label, and the explanation shown
 * to someone whose answer would stop them. Nothing else from the form.
 */
export const publicEligibilityItemSchema = z.strictObject({
  label: text(500),
  explanation: text(1000),
});

export type PublicEligibilityItem = z.infer<typeof publicEligibilityItemSchema>;

/**
 * An open round: its programme is open, it has opened and not closed, and it
 * has a published form version. Opening and closing are instants in UTC,
 * shown in `timeZone`, the tenant's.
 */
export const publicRoundSchema = z
  .strictObject({
    id: idSchema,
    title: text(120),
    programme: z.strictObject({ title: text(120), summary: text(300) }),
    opensAt: z.iso.datetime(),
    closesAt: z.iso.datetime(),
    timeZone,
    awardMinimum: amountSchema,
    awardMaximum: amountSchema,
    eligibility: z.array(publicEligibilityItemSchema).max(MAX_PUBLIC_ELIGIBILITY_ITEMS),
  })
  .refine((round) => round.awardMaximum.amountMinor >= round.awardMinimum.amountMinor, {
    ...says(programmeMessages.awardMaximum),
    path: ['awardMaximum'],
  });

export type PublicRound = z.infer<typeof publicRoundSchema>;

/** Closing soonest first, then by round title. */
export const publicRoundListSchema = z.strictObject({
  rounds: z.array(publicRoundSchema).max(MAX_PUBLIC_ROUNDS),
});

export type PublicRoundList = z.infer<typeof publicRoundListSchema>;
