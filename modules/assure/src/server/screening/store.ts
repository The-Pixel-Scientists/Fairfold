// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screening store (ADR 0031): the only place the list, runs, matches and
// decisions are read and written. Columns are the ones the classification map
// lists; the tenant is the transaction's own and times are the database's.
// Nothing here reads or writes a party or grants table, and nothing writes a
// decision but insertDecision(), which only a named member's request calls.

import type { Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/assure';

import type {
  Match,
  MatchDecision,
  MatchOutcome,
  MatchQuery,
  MatchReason,
  ScreeningRun,
} from '../../contracts/index.ts';
import type { EntryRow } from './list.ts';

export type Tx = Transaction<unknown>;

type Tables = Omit<DB, never> & { 'app.audit_event': { job_id: string | null; action: string } };

const assureDb = (tx: Tx) => tx.$extendTables<Tables>();

const SOURCE = 'uk_sanctions_list';
export const PAGE_SIZE = 50;

/**
 * pg_trgm's `%`, written with its schema so the planner can use the trigram
 * index (ADR 0025). Kysely has no operator for it and a module has no raw SQL
 * tag, so the operator is a constant node and the value stays a bound
 * parameter. An exception to ADR 0016's no-raw-SQL rule until packages/db
 * provides a trigram helper; replace this constant at its one use, in
 * candidatesQuery().
 *
 * Accepted on review, 22 November 2026: the fragment is this fixed text with
 * no parameters and nothing from a request reaches it, the name it compares
 * is bound through eb.val(), and it is used once. Nothing here can be
 * injected. The exception ends when the helper exists; do not copy it.
 */
const TRIGRAM_OPERATOR = {
  expressionType: undefined,
  toOperationNode: () => ({ kind: 'RawNode', sqlFragments: ['OPERATOR(ext.%)'], parameters: [] }),
} as never;

export interface CurrentList {
  readonly id: string;
  readonly rowCount: number;
  readonly lastCheckedAt: Date;
  readonly sha256: Buffer;
}

/** The live version of the list, or null when none has loaded. */
export async function currentList(tx: Tx): Promise<CurrentList | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.reference_list')
    .select(['id', 'row_count', 'last_checked_at', 'sha256'])
    .where('source', '=', SOURCE)
    .where('superseded_at', 'is', null)
    .executeTakeFirst();
  return row === undefined
    ? null
    : {
        id: row.id,
        rowCount: row.row_count,
        lastCheckedAt: row.last_checked_at,
        sha256: row.sha256,
      };
}

/**
 * The one write of the list, through ADR 0031's approved function: it makes a
 * new version current in one transaction and supersedes the one it replaces,
 * or, when `sha256` is the current version's, only records that it was
 * checked (then `publishedOn` is null and `rows` empty). Called only by the
 * download job.
 */
export async function loadReferenceList(
  tx: Tx,
  list: {
    readonly publishedOn: string | null;
    readonly sha256: Buffer;
    readonly rows: readonly EntryRow[];
  },
): Promise<void> {
  await assureDb(tx)
    .selectNoFrom((eb) =>
      eb
        .fn('assure.load_reference_list', [
          eb.val(SOURCE),
          eb.cast(eb.val(list.publishedOn), 'date'),
          eb.val(list.sha256),
          eb.cast(eb.val(JSON.stringify(list.rows)), 'jsonb'),
        ])
        .as('loaded'),
    )
    .execute();
}

export interface Candidate {
  readonly designationId: string;
  readonly entryKind: 'individual' | 'entity' | 'ship';
  readonly entryName: string;
  readonly normalisedName: string;
  readonly regime: string;
  readonly designatedOn: string | null;
  readonly datesOfBirth: readonly string[];
  readonly nationalities: readonly string[];
  readonly country: string | null;
  readonly similarity: number;
}

/**
 * Entries of one list version of the given kinds whose normalised name is at
 * least `threshold` like `variant`, best first and at most `cap`. The `%`
 * operator uses the trigram index at pg_trgm's own default; the threshold
 * then filters.
 */
export async function candidates(
  tx: Tx,
  listId: string,
  kinds: readonly ('individual' | 'entity')[],
  variant: string,
  threshold: number,
  cap: number,
): Promise<Candidate[]> {
  const rows = await candidatesQuery(tx, listId, kinds, variant, threshold, cap).execute();
  return rows.map((row) => ({
    designationId: row.designation_id,
    entryKind: row.entry_kind as Candidate['entryKind'],
    entryName: row.name,
    normalisedName: row.normalised_name,
    regime: row.regime,
    designatedOn: row.designated_on,
    datesOfBirth: row.dates_of_birth,
    nationalities: row.nationalities,
    country: row.country,
    similarity: row.score,
  }));
}

/** The query candidates() runs, so a test can plan exactly it. */
export function candidatesQuery(
  tx: Tx,
  listId: string,
  kinds: readonly ('individual' | 'entity')[],
  variant: string,
  threshold: number,
  cap: number,
) {
  return (
    assureDb(tx)
      .selectFrom('assure.sanctions_entry as e')
      .select((eb) => [
        'e.designation_id',
        'e.entry_kind',
        'e.name',
        'e.normalised_name',
        'e.regime',
        eb.cast<string | null>('e.designated_on', 'text').as('designated_on'),
        'e.dates_of_birth',
        'e.nationalities',
        'e.country',
        eb.fn<number>('ext.similarity', [eb.ref('e.normalised_name'), eb.val(variant)]).as('score'),
      ])
      // As text, so the planner does not read every entry of the version through the list's own
      // index and test each name, but starts from the trigram index on the name.
      .where((eb) => eb(eb.cast<string>('e.list_id', 'text'), '=', listId))
      .where('e.entry_kind', 'in', [...kinds])
      .where((eb) => eb(eb.ref('e.normalised_name'), TRIGRAM_OPERATOR, eb.val(variant)))
      .where((eb) =>
        eb(
          eb.fn<number>('ext.similarity', [eb.ref('e.normalised_name'), eb.val(variant)]),
          '>=',
          threshold,
        ),
      )
      .orderBy('score', 'desc')
      .orderBy('e.id')
      .limit(cap)
  );
}

export interface LookupNames {
  readonly registeredNames: readonly string[];
  readonly officers: readonly {
    readonly id: string;
    readonly name: string;
    readonly personId: string | null;
  }[];
}

/** The registered names and officers of an organisation's newest found snapshot on each register. */
export async function lookupNames(tx: Tx, organisationId: string): Promise<LookupNames> {
  const db = assureDb(tx);
  const snapshots = await db
    .selectFrom('assure.lookup_snapshot as s')
    .select(['s.id', 's.registered_name'])
    .where('s.organisation_id', '=', organisationId)
    .where('s.outcome', '=', 'found')
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('assure.lookup_snapshot as newer')
            .select('newer.id')
            .whereRef('newer.organisation_id', '=', 's.organisation_id')
            .whereRef('newer.registry', '=', 's.registry')
            .whereRef('newer.identifier', '=', 's.identifier')
            .where('newer.outcome', '=', 'found')
            .whereRef('newer.fetched_at', '>', 's.fetched_at'),
        ),
      ),
    )
    .execute();
  if (snapshots.length === 0) return { registeredNames: [], officers: [] };
  const officers = await db
    .selectFrom('assure.lookup_officer')
    .select(['id', 'name', 'person_id'])
    .where(
      'snapshot_id',
      'in',
      snapshots.map(({ id }) => id),
    )
    .orderBy('id')
    .execute();
  return {
    registeredNames: [
      ...new Set(snapshots.flatMap(({ registered_name }) => registered_name ?? [])),
    ],
    officers: officers.map(({ id, name, person_id }) => ({ id, name, personId: person_id })),
  };
}

/** Whether this job has already started its run, so a second delivery starts no other. */
export async function runStartedBy(tx: Tx, jobId: string): Promise<boolean> {
  const row = await assureDb(tx)
    .selectFrom('app.audit_event')
    .select('job_id')
    .where('job_id', '=', jobId)
    .where('action', '=', 'assure.screening_run.started')
    .executeTakeFirst();
  return row !== undefined;
}

export async function insertRun(
  tx: Tx,
  partyId: string,
  trigger: 'on_demand' | 'submission',
  requestedBy: string | null,
): Promise<string> {
  const { id } = await assureDb(tx)
    .insertInto('assure.screening_run')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      party_id: partyId,
      trigger,
      // The worker's right to insert a run leaves out the requester.
      ...(requestedBy === null ? {} : { requested_by: requestedBy }),
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** A run the worker is about to move on, locked so a second delivery waits and then finds it done. */
export async function lockQueuedRun(tx: Tx, runId: string) {
  return assureDb(tx)
    .selectFrom('assure.screening_run')
    .select(['id', 'party_id'])
    .where('id', '=', runId)
    .where('status', '=', 'queued')
    .forUpdate()
    .executeTakeFirst();
}

export interface RunOutcome {
  readonly status: 'completed' | 'stale_list' | 'no_list' | 'failed';
  readonly list: {
    readonly id: string;
    readonly lastCheckedAt: Date;
    readonly threshold: number;
  } | null;
  readonly namesScreened: number;
  readonly matchesRaised: number;
  readonly errorCode: string | null;
}

export async function finishRun(tx: Tx, runId: string, outcome: RunOutcome): Promise<void> {
  await assureDb(tx)
    .updateTable('assure.screening_run')
    .set({
      status: outcome.status,
      list_id: outcome.list?.id ?? null,
      list_last_checked_at: outcome.list?.lastCheckedAt ?? null,
      threshold: outcome.list?.threshold ?? null,
      names_screened: outcome.namesScreened,
      matches_raised: outcome.matchesRaised,
      error_code: outcome.errorCode,
    })
    .where('id', '=', runId)
    .execute();
}

export interface NewMatch {
  readonly runId: string;
  readonly partyId: string;
  readonly nameSource: 'party' | 'registered_name' | 'officer';
  readonly officerId: string | null;
  readonly subjectPartyId: string | null;
  readonly screenedName: string;
  readonly listId: string;
  readonly entry: Candidate;
  readonly similarity: number;
}

export async function insertMatch(tx: Tx, match: NewMatch): Promise<string> {
  const { entry } = match;
  const { id } = await assureDb(tx)
    .insertInto('assure.screening_match')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      run_id: match.runId,
      party_id: match.partyId,
      name_source: match.nameSource,
      officer_id: match.officerId,
      subject_party_id: match.subjectPartyId,
      screened_name: match.screenedName,
      list_id: match.listId,
      designation_id: entry.designationId,
      entry_kind: entry.entryKind,
      entry_name: entry.entryName,
      regime: entry.regime,
      designated_on: entry.designatedOn,
      dates_of_birth: [...entry.datesOfBirth],
      nationalities: [...entry.nationalities],
      country: entry.country,
      similarity: match.similarity.toFixed(3),
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** The entry details a person decides on, as one string to compare with a candidate's. */
export const entryFingerprint = (entry: Omit<Candidate, 'normalisedName' | 'similarity'>): string =>
  JSON.stringify([
    entry.entryKind,
    entry.entryName,
    entry.regime,
    entry.datesOfBirth,
    entry.nationalities,
    entry.country,
    entry.designatedOn,
  ]);

/**
 * Designations a person already decided were not a match, for the same party
 * and the same name, with the entry details they were decided against. A later
 * run raises none of them again unless the entry has changed (ADR 0031).
 */
export async function dismissedDesignations(
  tx: Tx,
  partyId: string,
  screenedName: string,
): Promise<ReadonlyMap<string, string>> {
  const db = assureDb(tx);
  const matches = await db
    .selectFrom('assure.screening_match as m')
    .select((eb) => [
      'm.id',
      'm.designation_id',
      'm.entry_kind',
      'm.entry_name',
      'm.regime',
      'm.dates_of_birth',
      'm.nationalities',
      'm.country',
      eb.cast<string | null>('m.designated_on', 'text').as('designated_on'),
    ])
    .where('m.party_id', '=', partyId)
    .where('m.screened_name', '=', screenedName)
    .execute();
  if (matches.length === 0) return new Map();
  const decisions = await decisionsOf(
    tx,
    matches.map(({ id }) => id),
  );
  const newest = new Map(decisions.map(({ match_id, outcome }) => [match_id, outcome]));
  return new Map(
    matches
      .filter(({ id }) => newest.get(id) === 'not_a_match')
      .map((row) => [
        row.designation_id,
        entryFingerprint({
          designationId: row.designation_id,
          entryKind: row.entry_kind as Candidate['entryKind'],
          entryName: row.entry_name,
          regime: row.regime,
          designatedOn: row.designated_on,
          datesOfBirth: row.dates_of_birth,
          nationalities: row.nationalities,
          country: row.country,
        }),
      ]),
  );
}

const runColumns = (tx: Tx) =>
  assureDb(tx)
    .selectFrom('assure.screening_run as r')
    .leftJoin('assure.reference_list as l', 'l.id', 'r.list_id')
    .select((eb) => [
      'r.id',
      'r.party_id',
      'r.trigger',
      'r.status',
      'r.created_at',
      'r.completed_at',
      'r.names_screened',
      'r.matches_raised',
      'r.list_last_checked_at',
      'l.id as list_id',
      'l.downloaded_at',
      eb.cast<string | null>('l.published_on', 'text').as('published_on'),
    ]);

type RunRow = Awaited<ReturnType<ReturnType<typeof runColumns>['executeTakeFirstOrThrow']>>;

function toRun(row: RunRow): ScreeningRun {
  return {
    id: row.id,
    partyId: row.party_id,
    trigger: row.trigger as ScreeningRun['trigger'],
    status: row.status as ScreeningRun['status'],
    list:
      row.list_id === null
        ? null
        : {
            id: row.list_id,
            publishedOn: row.published_on ?? '',
            downloadedAt: (row.downloaded_at ?? row.created_at).toISOString(),
            lastCheckedAt: (row.list_last_checked_at ?? row.created_at).toISOString(),
          },
    startedAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    namesScreened: row.names_screened,
    matchesRaised: row.matches_raised,
  };
}

export async function readRun(tx: Tx, runId: string): Promise<ScreeningRun | null> {
  const row = await runColumns(tx).where('r.id', '=', runId).executeTakeFirst();
  return row === undefined ? null : toRun(row);
}

/** A party's newest runs, newest first. */
export async function partyRuns(tx: Tx, partyId: string, limit: number): Promise<ScreeningRun[]> {
  const rows = await runColumns(tx)
    .where('r.party_id', '=', partyId)
    .orderBy('r.created_at', 'desc')
    .orderBy('r.id')
    .limit(limit)
    .execute();
  return rows.map(toRun);
}

const decisionsOf = (tx: Tx, matchIds: readonly string[]) =>
  assureDb(tx)
    .selectFrom('assure.match_decision')
    .select(['id', 'match_id', 'outcome', 'reason_code', 'decided_at', 'decided_by'])
    .where('match_id', 'in', [...matchIds])
    .orderBy('decided_at')
    .orderBy('id')
    .execute();

export type MatchSummary = Omit<
  Match,
  'screenedName' | 'officerId' | 'entry' | 'list' | 'decisions'
>;

/**
 * A page of matches, oldest first, each with its state from its newest
 * decision. The status filter applies to those states, so a page can hold
 * fewer than a page's worth while `next` still points on. `next` carries the
 * exact time of the last row read, which a JavaScript date would round.
 */
export async function matchPage(
  tx: Tx,
  query: MatchQuery,
  after: { readonly raised: string; readonly id: string } | null,
): Promise<{
  readonly rows: readonly MatchSummary[];
  readonly next: { readonly raised: string; readonly id: string } | null;
}> {
  let select = assureDb(tx)
    .selectFrom('assure.screening_match as m')
    .select((eb) => [
      'm.id',
      'm.run_id',
      'm.party_id',
      'm.subject_party_id',
      'm.name_source',
      'm.entry_kind',
      'm.similarity',
      'm.created_at',
      eb.cast<string>('m.created_at', 'text').as('raised_text'),
    ])
    .orderBy('m.created_at')
    .orderBy('m.id')
    .limit(PAGE_SIZE + 1);
  if (query.partyId !== undefined) select = select.where('m.party_id', '=', query.partyId);
  if (query.raisedBefore !== undefined) {
    const before = query.raisedBefore;
    select = select.where((eb) =>
      eb('m.created_at', '<', eb.cast<Date>(eb.val(before), 'timestamptz')),
    );
  }
  if (after !== null) {
    const { raised, id } = after;
    select = select.where((eb) =>
      eb.or([
        eb('m.created_at', '>', eb.cast<Date>(eb.val(raised), 'timestamptz')),
        eb.and([
          eb('m.created_at', '=', eb.cast<Date>(eb.val(raised), 'timestamptz')),
          eb('m.id', '>', id),
        ]),
      ]),
    );
  }
  const rows = await select.execute();
  const decisions =
    rows.length === 0
      ? []
      : await decisionsOf(
          tx,
          rows.map(({ id }) => id),
        );
  const newest = new Map(decisions.map((row) => [row.match_id, row.outcome]));
  const shaped = rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    partyId: row.party_id,
    subjectPartyId: row.subject_party_id,
    nameSource: row.name_source as MatchSummary['nameSource'],
    entryKind: row.entry_kind as MatchSummary['entryKind'],
    similarity: Number(row.similarity),
    status: (newest.get(row.id) ?? 'open') as MatchSummary['status'],
    raisedAt: row.created_at.toISOString(),
  }));
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: shaped
      .slice(0, PAGE_SIZE)
      .filter(({ status }) => query.status === undefined || status === query.status),
    next:
      rows.length > PAGE_SIZE && last !== undefined
        ? { raised: last.raised_text, id: last.id }
        : null,
  };
}

/** One match with its entry, list version and decisions, or null when this tenant has none. */
export async function readMatch(tx: Tx, matchId: string): Promise<Match | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.screening_match as m')
    .innerJoin('assure.reference_list as l', 'l.id', 'm.list_id')
    .select((eb) => [
      'm.id',
      'm.run_id',
      'm.party_id',
      'm.subject_party_id',
      'm.officer_id',
      'm.name_source',
      'm.entry_kind',
      'm.similarity',
      'm.created_at',
      'm.screened_name',
      'm.designation_id',
      'm.entry_name',
      'm.regime',
      eb.cast<string | null>('m.designated_on', 'text').as('designated_on'),
      'm.dates_of_birth',
      'm.nationalities',
      'm.country',
      'l.id as list_id',
      'l.downloaded_at',
      eb.cast<string>('l.published_on', 'text').as('published_on'),
    ])
    .where('m.id', '=', matchId)
    .executeTakeFirst();
  if (row === undefined) return null;
  const decisions = (await decisionsOf(tx, [matchId])).map((d) => ({
    id: d.id,
    outcome: d.outcome as MatchOutcome,
    reason: d.reason_code as MatchReason,
    decidedAt: d.decided_at.toISOString(),
    decidedBy: d.decided_by,
  }));
  return {
    id: row.id,
    runId: row.run_id,
    partyId: row.party_id,
    subjectPartyId: row.subject_party_id,
    nameSource: row.name_source as Match['nameSource'],
    entryKind: row.entry_kind as Match['entryKind'],
    similarity: Number(row.similarity),
    status: decisions.at(-1)?.outcome ?? 'open',
    raisedAt: row.created_at.toISOString(),
    screenedName: row.screened_name,
    officerId: row.officer_id,
    entry: {
      designationId: row.designation_id,
      name: row.entry_name,
      regime: row.regime,
      designatedOn: row.designated_on,
      datesOfBirth: row.dates_of_birth,
      nationalities: row.nationalities,
      country: row.country,
    },
    list: {
      id: row.list_id,
      publishedOn: row.published_on,
      downloadedAt: row.downloaded_at.toISOString(),
    },
    decisions,
  };
}

/** The one write of a decision: always a named member's, from the session. */
export async function insertDecision(
  tx: Tx,
  matchId: string,
  outcome: MatchOutcome,
  reason: MatchReason,
  membershipId: string,
): Promise<{ readonly id: string; readonly decidedAt: Date }> {
  const row = await assureDb(tx)
    .insertInto('assure.match_decision')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      match_id: matchId,
      outcome,
      reason_code: reason,
      decided_by: membershipId,
    }))
    .returning(['id', 'decided_at'])
    .executeTakeFirstOrThrow();
  return { id: row.id, decidedAt: row.decided_at };
}

/** One decision by its id, as the decide route answers it, or null when this tenant has none. */
export async function readDecision(tx: Tx, decisionId: string): Promise<MatchDecision | null> {
  const row = await assureDb(tx)
    .selectFrom('assure.match_decision')
    .select(['id', 'outcome', 'reason_code', 'decided_at', 'decided_by'])
    .where('id', '=', decisionId)
    .executeTakeFirst();
  return row === undefined
    ? null
    : {
        id: row.id,
        outcome: row.outcome as MatchOutcome,
        reason: row.reason_code as MatchReason,
        decidedAt: row.decided_at.toISOString(),
        decidedBy: row.decided_by,
      };
}
