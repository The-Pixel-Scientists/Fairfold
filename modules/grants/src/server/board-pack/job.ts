// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Making a board pack for the worker's board pack job (ADR 0009, "Jobs that
// act for a user"). The job holds a job request's id and nothing else; the
// request holds the requester, the applications, the pinned template version
// and the field list the API allowed. The stored list is a ceiling, never
// the source: this checks the requester again, finds the applications again
// under their current access, and computes the field list again from the
// data. If the requester lost the permission or an application left the
// tenant's submissions, or the list now holds a field the request did not,
// it makes nothing and ends `failed` with a code. Otherwise the pack is made
// from the list computed now. Delivery is at least once, so a request that
// is no longer queued is left alone. Making a pack changes no status, stage,
// decision, owner or record (rule 9).

import { attempt, type AuditChanges } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import { readOrganisationSnapshotNames } from '@pixel-scientists/party/server';

import { boardPackRequestSchema, EXPORT_READ_PERMISSION } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import type { BoardPackJobDependencies } from './context.ts';
import { packFields, selectApplications, showsOrganisation, type Requester } from './read.ts';
import { buildModel } from './sections.ts';
import { BOARD_PACK_KIND } from './request.ts';
import { boardPackDb } from './tables.ts';

/** The failure codes of the worker's closed list that this job ends with. */
export type BoardPackFailure = 'not_found' | 'precondition_failed' | 'invalid_payload' | 'internal';

const filtersSchema = boardPackRequestSchema.extend({ templateVersionId: idSchema });

export interface BoardPackJob {
  readonly jobRequestId: string;
  /**
   * Records an event in the job's transaction as the job: the system, the job id and the member
   * whose request caused it. The platform binds it, so the actor is never this code's choice.
   */
  readonly audit: (event: {
    readonly action: 'platform.document.generated';
    readonly entityId: string;
    readonly changes: AuditChanges;
  }) => Promise<void>;
}

/**
 * `done`: the pack is made, the request failed for good, or it was left alone (grants is off, or
 * the request was not queued). `missing`: no such request in this tenant.
 */
export type BoardPackOutcome = 'done' | 'missing';

export function makeBoardPack(deps: BoardPackJobDependencies) {
  return async (tx: Tx, job: BoardPackJob): Promise<BoardPackOutcome> => {
    const db = boardPackDb(tx);
    // A module that is off keeps its data and makes nothing; the request stays queued (ADR 0024).
    const grants = await db
      .selectFrom('app.tenant_module')
      .select('enabled')
      .where('module', '=', 'grants')
      .executeTakeFirst();
    if (grants?.enabled !== true) return 'done';

    const request = await db
      .selectFrom('app.job_request')
      .select(['status', 'filters', 'field_ids', 'requested_by'])
      .where('id', '=', job.jobRequestId)
      .where('kind', '=', BOARD_PACK_KIND)
      .forUpdate()
      .executeTakeFirst();
    if (request === undefined) return 'missing';
    if (request.status !== 'queued') return 'done';
    await db
      .updateTable('app.job_request')
      .set({ status: 'running' })
      .where('id', '=', job.jobRequestId)
      .execute();

    // Nothing but the code is kept: no value, name or library message.
    const fail = async (code: BoardPackFailure): Promise<'done'> => {
      await db
        .updateTable('app.job_request')
        .set({ status: 'failed', failure_code: code })
        .where('id', '=', job.jobRequestId)
        .execute();
      await job.audit({
        action: 'platform.document.generated',
        entityId: job.jobRequestId,
        changes: { 'app.job_request.failure_code': { after: code } },
      });
      return 'done';
    };

    const filters = filtersSchema.safeParse(request.filters);
    if (!filters.success) return fail('invalid_payload');
    const member = await db
      .selectFrom('app.membership')
      .select(['status', 'roles'])
      .where('id', '=', request.requested_by)
      .executeTakeFirst();
    const permissions = new Set<string>(
      member?.status === 'active' ? permissionsFor(member.roles, 'console') : [],
    );
    if (!permissions.has('grants.data.export') || !permissions.has(EXPORT_READ_PERMISSION)) {
      return fail('precondition_failed');
    }
    const template = await deps.boardPackTemplates.byId(tx, filters.data.templateVersionId);
    if (template?.kind !== 'board_pack') return fail('not_found');
    const applications = await selectApplications(tx, filters.data.applicationIds);
    if (applications === undefined) return fail('precondition_failed');

    const requester: Requester = {
      audience: 'staff',
      mayRecordDecisions: permissions.has('grants.decisions.record'),
    };
    const { fieldIds, answerClasses } = packFields(template, requester, applications);
    const allowed = new Set(request.field_ids);
    if (fieldIds.some((id) => !allowed.has(id))) return fail('precondition_failed');

    // Making the file runs in a savepoint: if the data, renderer or writer fails, nothing of it
    // stays, and the request ends `failed` in the same commit, with no message from the failure.
    const made = await attempt(tx, async () => {
      const organisations = new Map<string, string>();
      if (showsOrganisation(requester)) {
        const names = await readOrganisationSnapshotNames(
          { tx },
          applications.flatMap(({ snapshotId }) => (snapshotId === null ? [] : [snapshotId])),
        );
        for (const { id, snapshotId } of applications) {
          const name = snapshotId === null ? undefined : names.get(snapshotId);
          if (name !== undefined) organisations.set(id, name);
        }
      }
      const timeZone = await deps.tenantTimeZone(tx, await tenantOf(tx));
      const now = new Date();
      const model = buildModel(template, requester, applications, organisations, timeZone);
      const fileId = await deps.store(tx, {
        chunks: deps.render(model, now),
        fileName: `board-pack-${now.toISOString().slice(0, 10)}.pdf`,
        requesterId: request.requested_by,
        fieldIds,
        answerClasses,
      });
      await db
        .updateTable('app.job_request')
        .set({ status: 'ready', output_file_id: fileId })
        .where('id', '=', job.jobRequestId)
        .execute();
      await job.audit({
        action: 'platform.document.generated',
        entityId: job.jobRequestId,
        changes: {
          'app.file.id': { after: fileId },
          'app.document_template_version.id': { after: template.id },
          'grants.application.id': { before: null, after: applications.length },
        },
      });
    });
    if (!made) return fail('internal');
    return 'done';
  };
}

async function tenantOf(tx: Tx): Promise<string> {
  const { tenant } = await tx
    .selectNoFrom((eb) => eb.fn<string>('app.current_tenant_id', []).as('tenant'))
    .executeTakeFirstOrThrow();
  return tenant;
}
