// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for a board pack, and reading how it went (ADR 0009, "Jobs that act
// for a user"). The route has checked the session and `grants.data.export`;
// this also needs the permission to read applications, as the CSV export
// does, and re-parses the ids. Every application must be a submitted one of
// the tenant, or the whole request answers the same 404, which never says
// which id failed. The template is the tenant's latest board pack version,
// chosen here, and the field list is computed from the data: neither comes
// from the request. The request, its audit event and its job are written in
// the request's transaction. Only the member who asked reads the request.

import { idSchema } from '@pixel-scientists/domain';

import {
  boardPackRequestSchema,
  EXPORT_READ_PERMISSION,
  type BoardPackRequest as BoardPackRequestBody,
} from '../../contracts/index.ts';
import type { JobRequest } from '../../contracts/export/jobs.ts';
import type { Tx } from '../programme/tables.ts';
import type { BoardPackContext, BoardPackDependencies } from './context.ts';
import { packFields, selectApplications, type Requester } from './read.ts';
import { boardPackDb } from './tables.ts';

export const BOARD_PACK_KIND = 'board_pack';

/** The pack is for the whole tenant's staff: the route's scope is the tenant. */
export function requesterOf(context: Pick<BoardPackContext, 'membership'>): Requester {
  return {
    audience: 'staff',
    mayRecordDecisions: context.membership.permissions.has('grants.decisions.record'),
  };
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: BoardPackContext;
  readonly input: I;
}

export function boardPackRequestHandlers(deps: BoardPackDependencies) {
  async function requestBoardPack({
    tx,
    context,
    input,
  }: Args<{ body: BoardPackRequestBody }>): Promise<{ requestId: string }> {
    if (!context.membership.permissions.has(EXPORT_READ_PERMISSION)) throw deps.forbidden();
    const body = boardPackRequestSchema.safeParse(input.body);
    if (!body.success) throw deps.notFound();
    const ids = [...new Set(body.data.applicationIds)];
    const applications = await selectApplications(tx, ids);
    if (applications === undefined) throw deps.notFound();

    const by = { membershipId: context.membership.id, requestId: context.requestId };
    const template = await deps.boardPackTemplates.latestOrDefault(tx, by);
    const { fieldIds, answerClasses } = packFields(template, requesterOf(context), applications);
    const requestId = await deps.queueBoardPack(tx, by, {
      filters: { applicationIds: ids, templateVersionId: template.id },
      fieldIds,
      answerClasses,
    });
    return { requestId };
  }

  async function readBoardPack({
    tx,
    context,
    input,
  }: Args<{ params: { requestId: string } }>): Promise<JobRequest> {
    const { requestId: id } = input.params;
    const request = await boardPackDb(tx)
      .selectFrom('app.job_request')
      .select(['status', 'failure_code', 'output_file_id', 'requested_at', 'expires_at'])
      .where('id', '=', id)
      .where('kind', '=', BOARD_PACK_KIND)
      .where('requested_by', '=', context.membership.id)
      .executeTakeFirst();
    if (request === undefined) throw deps.notFound();

    const requestedAt = request.requested_at.toISOString();
    if (request.status === 'failed') {
      return { id, requestedAt, status: 'failed', failureCode: request.failure_code ?? 'internal' };
    }
    if (request.status === 'ready') {
      if (request.output_file_id === null || request.expires_at === null) throw deps.notFound();
      // Past its expiry a file is refused even before the expiry job removes it.
      if (request.expires_at.getTime() <= Date.now()) {
        return { id, requestedAt, status: 'expired' };
      }
      return {
        id,
        requestedAt,
        status: 'ready',
        fileId: request.output_file_id,
        expiresAt: request.expires_at.toISOString(),
      };
    }
    return { id, requestedAt, status: request.status };
  }

  return { requestBoardPack, readBoardPack };
}

/**
 * A retry with the same idempotency key answers the request it made. The
 * first answer holds no `id`, so it is the member's latest board pack request
 * that names the same applications.
 */
export async function replayBoardPack(
  { tx, context, input }: Args<{ body: BoardPackRequestBody }>,
  deps: Pick<BoardPackDependencies, 'notFound'>,
): Promise<{ requestId: string }> {
  const asked = [...new Set(input.body.applicationIds)].sort().join();
  const made = await boardPackDb(tx)
    .selectFrom('app.job_request')
    .select(['id', 'filters'])
    .where('kind', '=', BOARD_PACK_KIND)
    .where('requested_by', '=', context.membership.id)
    .orderBy('requested_at', 'desc')
    .execute();
  const same = made.find(({ filters }) => {
    const ids = (filters as { applicationIds?: unknown } | null)?.applicationIds;
    return (
      Array.isArray(ids) &&
      ids.every((id) => idSchema.safeParse(id).success) &&
      [...(ids as string[])].sort().join() === asked
    );
  });
  if (same === undefined) throw deps.notFound();
  return { requestId: same.id };
}
