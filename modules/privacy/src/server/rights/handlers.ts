// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Export and erasure from a rights request, and the consent audit. Each
// start is a named POST by the session's member after step-up (the platform
// has checked both): the handler checks the request, asks the platform's
// engine to run for the request's subject, and keeps the job request's id on
// the request in the same transaction. Privacy never writes a job request or
// clears a column itself (rule 9). Nothing here reads the request's summary.

import type { JobRequest } from '@pixel-scientists/domain/platform/subject-access';

import type { ConsentHistory } from '../../contracts/index.ts';
import { privacyDb, type Args, type PrivacyDependencies, type ReplayArgs } from '../context.ts';
import type { RequestParams } from '../requests/handlers.ts';
import { readRequestRow, type RequestRow } from '../requests/read.ts';
import type { RightsContext } from './subject-rights.ts';

type RightsArgs<I> = Omit<Args<I>, 'context'> & { readonly context: RightsContext };

type JobColumn = 'export_job_request_id' | 'erasure_job_request_id';

const TABLE = 'privacy.rights_request';

const refusals = {
  exportKind: 'Only an access or portability request can start an export.',
  erasureKind: 'Only an erasure request can start an erasure.',
  closed: 'This request is closed. Log a new request to start one.',
  identity: "Check and record the person's identity before you start this.",
  exportBusy: 'An export for this request is already running. Wait for it to finish.',
  erasureBusy: 'An erasure for this request has already started.',
} as const;

/** The identity check passed: verified, or recorded as not needed. */
const PASSED = ['verified', 'not_needed'];
const RUNNING = ['queued', 'running'];

export function rightsHandlers(deps: PrivacyDependencies) {
  /** The request, locked so two starts are judged one after the other; 404 if not in this tenant. */
  async function lockRequest({ tx, input }: RightsArgs<RequestParams>): Promise<RequestRow> {
    const row = await readRequestRow(tx, input.params.requestId, 'update');
    if (row === undefined) throw deps.notFound();
    return row;
  }

  function checkOpen(row: RequestRow, kinds: readonly string[], wrongKind: string) {
    if (!kinds.includes(row.kind)) throw deps.refuse(409, wrongKind);
    if (row.clock_state === 'closed') throw deps.refuse(409, refusals.closed);
    if (!PASSED.includes(row.identity_check)) throw deps.refuse(409, refusals.identity);
  }

  /** Keeps the job request's id on the request, and writes the event with the ids as values. */
  async function keep(
    { tx, context }: RightsArgs<unknown>,
    row: RequestRow,
    column: JobColumn,
    action: 'privacy.rights_request.export_started' | 'privacy.rights_request.erasure_started',
    jobRequestId: string,
  ) {
    await privacyDb(tx)
      .updateTable(TABLE)
      .set({ [column]: jobRequestId, updated_by: context.membership.id })
      .where('id', '=', row.id)
      .execute();
    await context.audit.record({
      action,
      entityId: row.id,
      changes: { [`${TABLE}.${column}`]: { after: jobRequestId } },
    });
  }

  async function startRequestExport(args: RightsArgs<RequestParams>) {
    const row = await lockRequest(args);
    checkOpen(row, ['access', 'portability'], refusals.exportKind);
    const { subjectRights } = args.context;
    const current =
      row.export_job_request_id === null
        ? null
        : await subjectRights.exportStatus(row.export_job_request_id);
    if (current !== null && RUNNING.includes(current.status)) {
      throw deps.refuse(409, refusals.exportBusy);
    }
    const requestId = await subjectRights.startExport(row.subject_person_id);
    await keep(
      args,
      row,
      'export_job_request_id',
      'privacy.rights_request.export_started',
      requestId,
    );
    return { requestId };
  }

  async function startRequestErasure(
    args: RightsArgs<RequestParams & { body: { confirm: true } }>,
  ) {
    const row = await lockRequest(args);
    checkOpen(row, ['erasure'], refusals.erasureKind);
    const { subjectRights } = args.context;
    const current =
      row.erasure_job_request_id === null
        ? null
        : await subjectRights.erasureStatus(row.erasure_job_request_id);
    if (current !== null && RUNNING.includes(current.status)) {
      throw deps.refuse(409, refusals.erasureBusy);
    }
    const requestId = await subjectRights.startErasure(row.subject_person_id);
    await keep(
      args,
      row,
      'erasure_job_request_id',
      'privacy.rights_request.erasure_started',
      requestId,
    );
    return { requestId };
  }

  /** A replayed start answers the job request the first one made, and starts and writes nothing. */
  const replayStarted =
    (column: JobColumn) =>
    async ({ tx, input }: ReplayArgs<RequestParams>) => {
      const row = await readRequestRow(tx, input.params.requestId);
      const requestId = row?.[column];
      if (requestId === null || requestId === undefined) throw deps.notFound();
      return { requestId };
    };

  async function getRequestExport({
    tx,
    context,
    input,
  }: RightsArgs<RequestParams>): Promise<JobRequest> {
    const row = await readRequestRow(tx, input.params.requestId);
    if (row?.export_job_request_id === null || row === undefined) throw deps.notFound();
    const status = await context.subjectRights.exportStatus(row.export_job_request_id);
    if (status === null) throw deps.notFound();
    await context.audit.read({ action: 'privacy.rights_request.export_viewed', entityId: row.id });
    return status;
  }

  async function getRequestErasure({ tx, context, input }: RightsArgs<RequestParams>) {
    const row = await readRequestRow(tx, input.params.requestId);
    if (row?.erasure_job_request_id === null || row === undefined) throw deps.notFound();
    const status = await context.subjectRights.erasureStatus(row.erasure_job_request_id);
    if (status === null) throw deps.notFound();
    return status;
  }

  async function getConsentHistory({
    context,
    input,
  }: RightsArgs<{ params: { personId: string } }>): Promise<ConsentHistory> {
    const { personId } = input.params;
    const entries = await context.subjectRights.consentHistory(personId);
    if (entries === null) throw deps.notFound();
    await context.audit.read({ action: 'privacy.consent_history.viewed', entityId: personId });
    return { entries };
  }

  return {
    startRequestExport,
    getRequestExport,
    startRequestErasure,
    getRequestErasure,
    getConsentHistory,
    replayStartRequestExport: replayStarted('export_job_request_id'),
    replayStartRequestErasure: replayStarted('erasure_job_request_id'),
  };
}
