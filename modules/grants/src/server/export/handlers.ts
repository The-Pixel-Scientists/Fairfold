// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 360Giving export route's handler (D14, D15), matched with its contract
// in apps/api/src/modules.ts. The platform has already checked the session,
// the permission and the scope rule. The file holds the accepted decisions
// that are released, in the tenant, for the chosen programme or round, and
// nothing else: no unreleased, waitlisted or declined decision, no contact,
// answer or score. Each download is audited.

import { organisationSummaries } from '@pixel-scientists/party/server';

import {
  MAX_EXPORT_GRANTS,
  type ThreeSixtyGivingExport,
  type ThreeSixtyGivingQuery,
} from '../../contracts/index.ts';
import type { Args } from '../programme/context.ts';
import { programmeExists, readRound } from '../programme/read.ts';
import { buildExport } from './build.ts';
import { publisherHandlers, readPublisher, type ExportDependencies } from './publisher.ts';
import { exportDb } from './tables.ts';

const refusals = {
  noPublisher:
    "Save the funder's 360Giving details before you export. They are printed in every file.",
  tooMany: `This export has more than ${MAX_EXPORT_GRANTS.toLocaleString('en-GB')} grants. Choose one round to export fewer.`,
} as const;

export function exportHandlers(deps: ExportDependencies) {
  async function get360GivingExport({
    tx,
    context,
    input,
  }: Args<{ query: ThreeSixtyGivingQuery }>): Promise<ThreeSixtyGivingExport> {
    const { programmeId, roundId } = input.query;
    const scopeId = programmeId ?? roundId;
    const found =
      programmeId === undefined
        ? roundId !== undefined && (await readRound(tx, roundId)) !== undefined
        : await programmeExists(tx, programmeId);
    if (!found || scopeId === undefined) throw deps.notFound();

    const publisher = await readPublisher(tx);
    if (publisher === null) throw deps.refuse(409, refusals.noPublisher);

    const rows = await exportDb(tx)
      .selectFrom('grants.decision as d')
      .innerJoin('grants.application as a', 'a.id', 'd.application_id')
      .innerJoin('grants.round as r', 'r.id', 'a.round_id')
      .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
      .select([
        'a.id as application_id',
        'a.organisation_id',
        'd.amount_minor',
        'd.currency',
        'd.released_at',
        'd.updated_at as decision_updated_at',
        'r.title as round_title',
        'r.updated_at as round_updated_at',
        'p.title as programme_title',
        'p.summary as programme_summary',
        'p.updated_at as programme_updated_at',
      ])
      .where('d.outcome', '=', 'accepted')
      .where('d.released_at', 'is not', null)
      .where(programmeId === undefined ? 'r.id' : 'p.id', '=', scopeId)
      .orderBy('d.released_at')
      .orderBy('d.id')
      .limit(MAX_EXPORT_GRANTS + 1)
      .execute();
    if (rows.length > MAX_EXPORT_GRANTS) throw deps.refuse(400, refusals.tooMany);

    const organisations = new Map(
      (await organisationSummaries(tx, [...new Set(rows.map((row) => row.organisation_id))])).map(
        (organisation) => [organisation.id, organisation],
      ),
    );
    const timeZone = await deps.tenantTimeZone(tx, context.session.tenant);
    const built = buildExport(rows, publisher, organisations, timeZone);

    await context.audit.record({
      action: 'grants.export.downloaded',
      entityId: scopeId,
      changes: { 'grants.decision.id': { before: null, after: built.summary.grants } },
    });
    return built;
  }

  return { get360GivingExport, ...publisherHandlers(deps) };
}
