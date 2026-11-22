// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browsing a tenant's open rounds before sign-in (ADR 0035, ADR 0019). The
// routes need no session and set no tenant. The function gives no rows for an
// unknown, suspended or switched-off tenant and for a round that is not open,
// so every one of them, and a tenant with nothing open, answers the same 404.
// A row is mapped and checked against the contract's strict schema before it
// is sent; a row that fails answers the generic 500 with nothing from it.

import { idSchema } from '@pixel-scientists/domain';
import {
  publicEligibilityItemSchema,
  publicRoundSchema,
  type getPublicRound,
  type listPublicRounds,
  type PublicRound,
} from '@pixel-scientists/grants/contracts';
import { z } from 'zod';

import type { PublicTenants } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import type { OpenRoundRow } from './open-rounds.ts';

const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

const rowSchema = z.strictObject({
  round_id: idSchema,
  programme_title: z.string(),
  programme_summary: z.string(),
  round_title: z.string(),
  opens_at: z.date(),
  closes_at: z.date(),
  timezone: z.string(),
  award_min_minor: z.string().regex(/^[0-9]{1,15}$/),
  award_max_minor: z.string().regex(/^[0-9]{1,15}$/),
  currency: z.string(),
  eligibility: z.array(publicEligibilityItemSchema),
});

function toPublicRound(row: OpenRoundRow): PublicRound {
  try {
    const r = rowSchema.parse(row);
    return publicRoundSchema.parse({
      id: r.round_id,
      title: r.round_title,
      programme: { title: r.programme_title, summary: r.programme_summary },
      opensAt: r.opens_at.toISOString(),
      closesAt: r.closes_at.toISOString(),
      timeZone: r.timezone,
      awardMinimum: { amountMinor: Number(r.award_min_minor), currency: r.currency },
      awardMaximum: { amountMinor: Number(r.award_max_minor), currency: r.currency },
      eligibility: r.eligibility,
    });
  } catch {
    // The row's own words stay out of the log: a schema message can quote a value.
    throw new Error('A public round did not pass its schema.');
  }
}

export function programmeHandlers(tenants: PublicTenants) {
  const listPublicRoundsHandler: Handler<typeof listPublicRounds> = async ({ input }) => {
    const rows = await tenants.rounds(input.params.slug);
    if (rows.length === 0) throw notFound();
    return { rounds: rows.map(toPublicRound) };
  };

  const getPublicRoundHandler: Handler<typeof getPublicRound> = async ({ input }) => {
    const rows = await tenants.rounds(input.params.slug);
    const row = rows.find((found) => found.round_id === input.params.roundId);
    if (row === undefined) throw notFound();
    return toPublicRound(row);
  };

  return { listPublicRoundsHandler, getPublicRoundHandler };
}
