// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screening job (ADR 0009, ADR 0031). apps/api defines the tenant queue
// `assure.screening`, whose payload is `{ runId }`, and passes in what the job
// needs from it. The job moves a queued run on exactly once: it reads the
// party's names through party's contract and, for an organisation, its
// newest lookups, compares each with the live list, raises a possible match
// for each candidate and records the run's status. A match is only a
// suggestion for a person to review: nothing here rejects, holds, scores,
// pays or decides, and no decision is written here (rule 9). Names never
// reach a job payload, a log line, an audit value or an error.

import type { AuditChanges } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';

import { normaliseName, nameVariants, sameWords, type NameKind } from './normalise.ts';
import {
  candidates,
  currentList,
  dismissedDesignations,
  entryFingerprint,
  finishRun,
  insertMatch,
  lockQueuedRun,
  lookupNames,
  type Candidate,
  type Tx,
} from './store.ts';
import { assureIsOn, organisationIsErased } from '../registries/store.ts';

export const SCREENING_QUEUE = 'assure.screening';

/** The platform's default similarity (ADR 0031); a run never uses a higher one. */
export const DEFAULT_THRESHOLD = 0.5;
/** The most candidates one name takes from the index for each of its word orders. */
export const CANDIDATE_CAP = 20;
/** A list last checked longer ago than this is stale (ADR 0031). */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** One name of a party, with the party it is the name of. Read through party's contract. */
export interface PartyName {
  readonly partyId: string;
  readonly kind: NameKind;
  readonly name: string;
}

/** What the job and the routes need from party: names only, never written back. */
export interface PartyReader {
  /**
   * The party's own name, and for an organisation its current contacts'
   * names, or null when the tenant has no such party.
   */
  readonly names: (tx: Tx, partyId: string) => Promise<readonly PartyName[] | null>;
}

/** The codes a failed job ends with: the worker's closed list, never a message. */
export type ScreeningFailureCode = 'invalid_payload' | 'internal';

export interface ScreeningJob {
  readonly id: string;
  readonly data: unknown;
  readonly context: { readonly requestId: string; readonly causingUserId: string | null };
}

export interface RunAuditEvent {
  readonly action: 'assure.screening_run.started' | 'assure.screening_run.completed';
  readonly entityId: string;
  readonly subjectPartyId: string;
  readonly changes: AuditChanges;
}

export interface MatchFound {
  readonly matchId: string;
  readonly runId: string;
  readonly partyId: string;
  readonly listId: string;
}

export interface ScreeningDependencies {
  readonly party: PartyReader;
  /** Writes an audit event as the job: the system, with the job id and originating member. */
  readonly audit: (tx: Tx, job: ScreeningJob, event: RunAuditEvent) => Promise<void>;
  /** Publishes `assure.screening_match_found.v1` in the job's transaction. */
  readonly publishMatchFound: (
    tx: Tx,
    data: MatchFound,
    by: ScreeningJob['context'],
  ) => Promise<void>;
  readonly fail: (code: ScreeningFailureCode) => Error;
  readonly now?: () => Date;
}

interface Screened {
  readonly kind: NameKind;
  readonly name: string;
  readonly source: 'party' | 'registered_name' | 'officer';
  readonly officerId: string | null;
  readonly subjectPartyId: string | null;
}

/** A name as a column holds it: no control characters, at most 300 long. */
const clean = (name: string): string =>
  name
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

async function namesOf(
  tx: Tx,
  partyId: string,
  parties: readonly PartyName[],
): Promise<Screened[]> {
  const screened: Screened[] = parties.map(({ partyId: subject, kind, name }) => ({
    kind,
    name,
    source: 'party',
    officerId: null,
    subjectPartyId: subject,
  }));
  if (parties.some(({ partyId: id, kind }) => id === partyId && kind === 'organisation')) {
    const { registeredNames, officers } = await lookupNames(tx, partyId);
    for (const name of registeredNames) {
      screened.push({
        kind: 'organisation',
        name,
        source: 'registered_name',
        officerId: null,
        subjectPartyId: partyId,
      });
    }
    for (const officer of officers) {
      screened.push({
        kind: 'person',
        name: officer.name,
        source: 'officer',
        officerId: officer.id,
        subjectPartyId: officer.personId,
      });
    }
  }
  const seen = new Set<string>();
  return screened.flatMap((item) => {
    const name = clean(item.name);
    const key = `${item.kind}:${normaliseName(name, item.kind)}:${item.officerId ?? item.subjectPartyId ?? ''}`;
    if (name === '' || seen.has(key)) return [];
    seen.add(key);
    return [{ ...item, name }];
  });
}

/** Each designation's best candidate across the name's word orders. */
async function bestCandidates(
  tx: Tx,
  listId: string,
  item: Screened,
  threshold: number,
): Promise<Candidate[]> {
  const normalised = normaliseName(item.name, item.kind);
  const best = new Map<string, Candidate>();
  for (const variant of nameVariants(normalised)) {
    const found = await candidates(
      tx,
      listId,
      [item.kind === 'person' ? 'individual' : 'entity'],
      variant,
      threshold,
      CANDIDATE_CAP,
    );
    for (const candidate of found) {
      const similarity = sameWords(normalised, candidate.normalisedName) ? 1 : candidate.similarity;
      if ((best.get(candidate.designationId)?.similarity ?? -1) < similarity) {
        best.set(candidate.designationId, { ...candidate, similarity });
      }
    }
  }
  return [...best.values()].sort(
    (a, b) => b.similarity - a.similarity || a.designationId.localeCompare(b.designationId),
  );
}

/**
 * The worker's handler for `assure.screening`. With assure off for the
 * tenant it does nothing. A run that is not queued (a second delivery, or no
 * such run in this tenant) does nothing. A party that is gone or erased ends
 * the run `failed` with a code, so staff see why; the job itself completes,
 * since trying again cannot help.
 */
export function screeningJob(deps: ScreeningDependencies) {
  return async (tx: Tx, job: ScreeningJob): Promise<void> => {
    const payload = job.data;
    const runId =
      typeof payload === 'object' && payload !== null && Object.keys(payload).length === 1
        ? idSchema.safeParse((payload as Record<string, unknown>)['runId'])
        : null;
    if (runId === null || !runId.success) throw deps.fail('invalid_payload');
    if (!(await assureIsOn(tx))) return;
    const run = await lockQueuedRun(tx, runId.data);
    if (run === undefined) return;

    const finish = async (
      status: 'completed' | 'stale_list' | 'no_list' | 'failed',
      list: Parameters<typeof finishRun>[2]['list'],
      names: number,
      matches: number,
      errorCode: string | null,
    ): Promise<void> => {
      await finishRun(tx, run.id, {
        status,
        list,
        namesScreened: names,
        matchesRaised: matches,
        errorCode,
      });
      await deps.audit(tx, job, {
        action: 'assure.screening_run.completed',
        entityId: run.id,
        subjectPartyId: run.party_id,
        changes: {
          'assure.screening_run.status': { after: status },
          'assure.screening_run.names_screened': { after: names },
          'assure.screening_run.matches_raised': { after: matches },
        },
      });
    };

    const parties = (await organisationIsErased(tx, run.party_id))
      ? null
      : await deps.party.names(tx, run.party_id);
    if (parties === null) return finish('failed', null, 0, 0, 'party_unavailable');

    const list = await currentList(tx);
    if (list === null) return finish('no_list', null, 0, 0, null);

    const now = deps.now?.() ?? new Date();
    const screened = await namesOf(tx, run.party_id, parties);
    let raised = 0;
    for (const item of screened) {
      const dismissed = await dismissedDesignations(tx, run.party_id, item.name);
      for (const entry of await bestCandidates(tx, list.id, item, DEFAULT_THRESHOLD)) {
        if (dismissed.get(entry.designationId) === entryFingerprint(entry)) continue;
        const matchId = await insertMatch(tx, {
          runId: run.id,
          partyId: run.party_id,
          nameSource: item.source,
          officerId: item.officerId,
          subjectPartyId: item.subjectPartyId,
          screenedName: item.name,
          listId: list.id,
          entry,
          similarity: entry.similarity,
        });
        raised += 1;
        await deps.publishMatchFound(
          tx,
          { matchId, runId: run.id, partyId: run.party_id, listId: list.id },
          job.context,
        );
      }
    }
    const stale = list.lastCheckedAt.getTime() < now.getTime() - STALE_AFTER_MS;
    await finish(
      stale ? 'stale_list' : 'completed',
      { id: list.id, lastCheckedAt: list.lastCheckedAt, threshold: DEFAULT_THRESHOLD },
      screened.length,
      raised,
      null,
    );
  };
}
