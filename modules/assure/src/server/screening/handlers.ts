// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screening and match routes' handlers (ADR 0031, rule 9), for staff only.
// The platform has already checked the session, the permission, the step-up
// window and that assure is on; every input is checked again here. A run is
// only queued in the request's transaction, never matched in it. A match is
// decided only here, by the member in the session, and the body can name
// neither a member nor a note. A record the caller may not reach reads
// exactly as a missing one does. Audit events hold ids and codes, with the
// party as the subject, never a name.

import type { AuditChanges } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';

import {
  matchDecisionInputSchema,
  matchQuerySchema,
  type AssureAuditAction,
  type MatchDecision,
} from '../../contracts/index.ts';
import { organisationIsErased } from '../registries/store.ts';
import type { PartyReader } from './run.ts';
import {
  insertDecision,
  insertRun,
  matchPage,
  partyRuns,
  readDecision,
  readMatch,
  readRun,
  type Tx,
} from './store.ts';

const RUN_LIMIT = 50;

/** What a handler reads from the request context. */
export interface ScreeningContext {
  readonly requestId: string;
  readonly audit: {
    record(event: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    read(entity: {
      readonly action: AssureAuditAction;
      readonly entityId: string;
      readonly subjectPartyId: string;
    }): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

export interface ScreeningRouteDependencies {
  readonly party: PartyReader;
  /** Queues the screening job in the request's transaction. */
  readonly queueScreening: (
    tx: Tx,
    data: { readonly runId: string },
    by: { readonly requestId: string; readonly causingUserId: string | null },
  ) => Promise<unknown>;
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: ScreeningContext;
  readonly input: I;
}

const encodeCursor = (raised: string, id: string): string =>
  Buffer.from(`${raised}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { raised: string; id: string } | null {
  const [raised, id, ...rest] = Buffer.from(cursor, 'base64url').toString().split('|');
  return rest.length === 0 &&
    raised !== undefined &&
    /^\d{4}-\d{2}-\d{2} [\d:.]+(?:[+-]\d{2}(?::\d{2})?)?$/.test(raised) &&
    idSchema.safeParse(id).success
    ? { raised, id: id as string }
    : null;
}

export function screeningHandlers(deps: ScreeningRouteDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };
  const partyOrNotFound = async (tx: Tx, value: unknown): Promise<string> => {
    const partyId = idOrNotFound(value);
    if ((await deps.party.names(tx, partyId)) === null) throw deps.notFound();
    return partyId;
  };

  return {
    /** Queues a run for a party of this tenant. The run is matched later, by the worker. */
    startScreeningRun: async ({ tx, context, input }: Args<{ params: { partyId: string } }>) => {
      const partyId = await partyOrNotFound(tx, input.params.partyId);
      if (await organisationIsErased(tx, partyId)) {
        throw deps.refuse(409, "This party has been erased, so it can't be screened.");
      }
      const runId = await insertRun(tx, partyId, 'on_demand', context.membership.id);
      await deps.queueScreening(
        tx,
        { runId },
        { requestId: context.requestId, causingUserId: context.membership.id },
      );
      await context.audit.record({
        action: 'assure.screening_run.started',
        entityId: runId,
        subjectPartyId: partyId,
        changes: { 'assure.screening_run.trigger': { after: 'on_demand' } },
      });
      const run = await readRun(tx, runId);
      if (run === null) throw deps.notFound();
      return run;
    },

    /** For a replay of the run request: the run as it reads now. Queues, audits and writes nothing. */
    replayScreeningRun: async ({ tx, id }: { tx: Tx; id: string | null }) => {
      const run = await readRun(tx, idOrNotFound(id));
      if (run === null) throw deps.notFound();
      return run;
    },

    /** For a replay of a decision: that decision as it reads now. Records and audits nothing. */
    replayMatchDecision: async ({
      tx,
      id,
    }: {
      tx: Tx;
      id: string | null;
    }): Promise<MatchDecision> => {
      const decision = await readDecision(tx, idOrNotFound(id));
      if (decision === null) throw deps.notFound();
      return decision;
    },

    listScreeningRuns: async ({ tx, input }: Args<{ params: { partyId: string } }>) => {
      const partyId = await partyOrNotFound(tx, input.params.partyId);
      return { runs: await partyRuns(tx, partyId, RUN_LIMIT) };
    },

    getScreeningRun: async ({ tx, input }: Args<{ params: { runId: string } }>) => {
      const run = await readRun(tx, idOrNotFound(input.params.runId));
      if (run === null) throw deps.notFound();
      return run;
    },

    /** Matches by ids and codes, oldest first: no name, so no sensitive read. */
    listScreeningMatches: async ({ tx, input }: Args<{ query: unknown }>) => {
      const query = matchQuerySchema.safeParse(input.query);
      if (!query.success) throw deps.refuse(400, 'Check the filters and try again.');
      const after = query.data.cursor === undefined ? null : decodeCursor(query.data.cursor);
      if (query.data.cursor !== undefined && after === null) {
        throw deps.refuse(400, 'That page link is not valid. Start again from the first page.');
      }
      const { rows, next } = await matchPage(tx, query.data, after);
      return {
        matches: [...rows],
        nextCursor: next === null ? null : encodeCursor(next.raised, next.id),
      };
    },

    /** A match beside its listed entry: names, so each read is audited. */
    getScreeningMatch: async ({ tx, context, input }: Args<{ params: { matchId: string } }>) => {
      const match = await readMatch(tx, idOrNotFound(input.params.matchId));
      if (match === null) throw deps.notFound();
      await context.audit.read({
        action: 'assure.screening_match.viewed',
        entityId: match.id,
        subjectPartyId: match.subjectPartyId ?? match.partyId,
      });
      return match;
    },

    /** Records a named member's decision. A later decision supersedes an earlier one. */
    decideScreeningMatch: async ({
      tx,
      context,
      input,
    }: Args<{ params: { matchId: string }; body: unknown }>): Promise<MatchDecision> => {
      const matchId = idOrNotFound(input.params.matchId);
      const body = matchDecisionInputSchema.safeParse(input.body);
      if (!body.success) throw deps.refuse(400, 'Choose an outcome with a reason that fits it.');
      const match = await readMatch(tx, matchId);
      if (match === null) throw deps.notFound();
      const { outcome, reason } = body.data;
      if (outcome !== 'not_a_match' && match.subjectPartyId === null) {
        throw deps.refuse(
          409,
          'Link the officer to a person before deciding anything but not a match.',
        );
      }
      const decision = await insertDecision(tx, matchId, outcome, reason, context.membership.id);
      await context.audit.record({
        action: 'assure.screening_match.decided',
        entityId: matchId,
        subjectPartyId: match.subjectPartyId ?? match.partyId,
        changes: {
          'assure.match_decision.outcome': { after: outcome },
          'assure.match_decision.reason_code': { after: reason },
        },
      });
      return {
        id: decision.id,
        outcome,
        reason,
        decidedAt: decision.decidedAt.toISOString(),
        decidedBy: context.membership.id,
      };
    },
  };
}
