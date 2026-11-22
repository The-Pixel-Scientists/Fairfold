// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Merging two organisations or two people (ADR 0025, architecture rule 9).
// Only the named staff routes here reach party's executor; no job, event
// handler or timer does. The platform has already checked `crm.parties.merge`
// and the step-up window, and the deciding member is the session's.
//
// A preview runs the executor in a savepoint and always rolls it back, so it
// shows exactly the conflicts and counts a merge would have and changes
// nothing. A confirm builds that preview again, refuses a token that is not
// the one for it, then merges and writes the one `crm.merge_record`, all in
// the request's transaction: any failure undoes the whole merge. Nothing in
// an audit event, problem or log holds a name, email or field value.

import {
  valueHistoryFields,
  type MergeCounts,
  type MergeOutcome,
  type PartyKind,
  type ValueHistoryField,
} from '@pixel-scientists/party/contracts';

import {
  checkPreviewToken,
  crmMessages,
  makePreviewToken,
  mergeConflictMessages,
  previewBasisText,
  type MergePreview,
  type MergeRecord,
  type PreviewBasis,
} from '../contracts/index.ts';
import {
  crmDb,
  iso,
  partyRequest,
  type Args,
  type CrmContext,
  type CrmDependencies,
  type Tx,
} from './context.ts';

export interface Choice {
  readonly loserId: string;
  readonly survivorId: string;
  readonly kind: PartyKind;
}

/** What a rehearsed merge writes to the audit log: nothing. */
const silent: CrmContext['audit'] = {
  record: () => Promise.resolve(),
  read: () => Promise.resolve(),
};

/** Thrown inside the savepoint of a rehearsal so that it is always undone. */
const REHEARSED = new Error('A rehearsed merge is always undone.');

const toRecord = (row: {
  id: string;
  kind: PartyKind;
  loser_id: string;
  survivor_id: string;
  repointed_counts: unknown;
  merged_by: string;
  merged_at: Date;
}): MergeRecord => ({
  id: row.id,
  kind: 'merge',
  partyKind: row.kind,
  loserId: row.loser_id,
  survivorId: row.survivor_id,
  reverses: null,
  decidedAt: iso(row.merged_at),
  decidedBy: row.merged_by,
  counts: row.repointed_counts as MergeCounts,
});

const COLUMNS = [
  'id',
  'kind',
  'loser_id',
  'survivor_id',
  'repointed_counts',
  'merged_by',
  'merged_at',
] as const;

/** `module.table:count` for each table the merge changed, which the audit log keeps as a short list. */
const countLines = (counts: MergeCounts): string[] =>
  Object.values(counts).flatMap((tables) =>
    Object.entries(tables).map(([table, count]) => `${table}:${count}`),
  );

export function mergeHandlers(deps: CrmDependencies) {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  /** The preview's basis: what the merge would do now, with nothing changed. */
  async function basisOf(tx: Tx, context: CrmContext, choice: Choice): Promise<PreviewBasis> {
    const { loserId, survivorId, kind } = choice;
    const found = await deps.parties.facts(tx, [loserId, survivorId]);
    if (found.length !== new Set([loserId, survivorId]).size) throw deps.notFound();
    const sameKind = found.every((party) => party.kind === kind);

    const fields: PreviewBasis['fields'][number][] = [];
    if (sameKind) {
      const loser = await deps.parties.values(tx, kind, loserId);
      const survivor = await deps.parties.values(tx, kind, survivorId);
      for (const [fieldId, owner] of Object.entries(valueHistoryFields)) {
        if (owner !== kind) continue;
        const id = fieldId as ValueHistoryField;
        fields.push({
          fieldId: id,
          loser: loser.get(id) ?? null,
          survivor: survivor.get(id) ?? null,
        });
      }
    }

    // Party decides whether a person's links are carried over.
    let linkRule: PreviewBasis['linkRule'] = 'none';
    const links: { relationshipId: string; personId: string; organisationId: string }[] = [];
    if (sameKind && kind === 'person' && loserId !== survivorId) {
      const carried = await deps.parties.carriedLinks(tx, loserId, survivorId);
      if (carried !== null) {
        linkRule = 'automatic';
        for (const link of carried) links.push({ ...link, personId: loserId });
      }
    }

    const rehearsal: { outcome?: MergeOutcome } = {};
    await deps.attempt(tx, async () => {
      rehearsal.outcome = await deps.merges.mergeParties(
        { ...partyRequest(tx, context), audit: silent },
        choice,
      );
      throw REHEARSED;
    });
    const settled = rehearsal.outcome;
    if (settled === undefined) throw new Error('The merge preview failed.');

    return {
      loserId,
      survivorId,
      kind,
      fields,
      conflicts: settled.merged ? [] : [settled.conflict],
      counts: settled.merged ? settled.counts : {},
      linkRule,
      links,
    };
  }

  const owner = ({ session, membership }: CrmContext) => ({
    tenantId: session.tenant,
    membershipId: membership.id,
  });

  async function previewMerge({
    tx,
    context,
    input,
  }: Args<{ body: Choice }>): Promise<MergePreview> {
    const { loserId, survivorId, kind } = input.body;
    const basis = await basisOf(tx, context, { loserId, survivorId, kind });
    for (const id of [loserId, survivorId]) {
      await context.audit.read({ action: 'crm.merge.previewed', entityId: id, subjectPartyId: id });
    }
    return {
      ...basis,
      fields: [...basis.fields],
      conflicts: [...basis.conflicts],
      links: basis.links.map((link) => ({ ...link })) as MergePreview['links'],
      token: makePreviewToken(now(), owner(context), basis, deps.signPreview),
    };
  }

  async function confirmMerge({
    tx,
    context,
    input,
  }: Args<{
    body: Choice & { carryOver: readonly string[]; token: string };
  }>): Promise<MergeRecord> {
    const { loserId, survivorId, kind, carryOver, token } = input.body;
    if (carryOver.length > 0) {
      throw deps.refuse(
        400,
        'No contact links can be carried over in this merge. Confirm without choosing links.',
      );
    }
    const basis = await basisOf(tx, context, { loserId, survivorId, kind });
    if (!checkPreviewToken(token, now(), owner(context), basis, deps.signPreview)) {
      throw deps.refuse(409, crmMessages.previewToken);
    }
    const [conflict] = basis.conflicts;
    if (conflict !== undefined) throw deps.refuse(409, mergeConflictMessages[conflict]);

    const outcome = await deps.merges.mergeParties(partyRequest(tx, context), {
      loserId,
      survivorId,
      kind,
    });
    if (!outcome.merged) throw deps.refuse(409, mergeConflictMessages[outcome.conflict]);

    const row = await crmDb(tx)
      .insertInto('crm.merge_record')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        kind,
        action: 'merge',
        loser_id: loserId,
        survivor_id: survivorId,
        repointed_counts: outcome.counts,
        preview_hash: deps.digest(previewBasisText(basis)),
        merged_by: context.membership.id,
      }))
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'crm.merge.confirmed',
      entityId: row.id,
      subjectPartyId: loserId,
      changes: {
        'crm.merge_record.kind': { after: kind },
        'crm.merge_record.loser_id': { after: loserId },
        'crm.merge_record.survivor_id': { after: survivorId },
        'crm.merge_record.repointed_counts': { after: countLines(outcome.counts) },
      },
    });
    return toRecord(row);
  }

  async function getMergeRecord({
    tx,
    input,
  }: Args<{ params: { mergeRecordId: string } }>): Promise<MergeRecord> {
    const row = await crmDb(tx)
      .selectFrom('crm.merge_record')
      .select(COLUMNS)
      .where('id', '=', input.params.mergeRecordId)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toRecord(row);
  }

  async function listPartyMerges({
    tx,
    input,
  }: Args<{ params: { partyId: string } }>): Promise<{ records: MergeRecord[] }> {
    const { partyId } = input.params;
    const [party] = await deps.parties.facts(tx, [partyId]);
    if (party === undefined) throw deps.notFound();
    const rows = await crmDb(tx)
      .selectFrom('crm.merge_record')
      .select(COLUMNS)
      .where((eb) => eb.or([eb('loser_id', '=', partyId), eb('survivor_id', '=', partyId)]))
      .orderBy('merged_at', 'desc')
      .orderBy('id')
      .execute();
    return { records: rows.map(toRecord) };
  }

  return { previewMerge, confirmMerge, getMergeRecord, listPartyMerges };
}
