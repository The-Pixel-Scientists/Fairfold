// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant's own equality monitoring answers (ADR 0032). Special
// category data under their own consent, apart from the application: the
// portal reads and withdraws it, only after the application is submitted, and
// nothing here changes the application. No answer, field id or whether anyone
// answered goes to an audit event, a log line or a problem. A changed answer
// is a withdrawal and a new response, so withdrawing deletes the row.
//
// Answering and reading the round's form need the round's monitoring form
// version, which no table holds yet, so they are not here.

import { projectedAnswers } from '@pixel-scientists/domain/api';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';

import type { GrantsAuditAction, MonitoringAnswer } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';
import { monitoringDb } from './tables.ts';

export type MonitoringDependencies = Pick<GrantsDependencies, 'notFound'>;

export interface MonitoringArgs {
  readonly tx: Tx;
  readonly context: {
    readonly audit: {
      record(event: {
        readonly action: GrantsAuditAction;
        readonly entityId: string;
        readonly changes?: Record<string, { before?: unknown; after?: unknown }>;
      }): Promise<void>;
      read(event: { readonly action: GrantsAuditAction; readonly entityId: string }): Promise<void>;
    };
  };
  readonly input: { readonly params: { readonly applicationId: string } };
}

const column = (name: string) => `grants.monitoring_response.${name}`;

export function monitoringHandlers(deps: MonitoringDependencies) {
  /** Monitoring is after submission only: a draft, or no such application, is a 404. */
  async function requireSubmitted(tx: Tx, applicationId: string): Promise<void> {
    const application = await monitoringDb(tx)
      .selectFrom('grants.application')
      .select('status')
      .where('id', '=', applicationId)
      .executeTakeFirst();
    if (application === undefined || application.status === 'draft') throw deps.notFound();
  }

  async function getMonitoringResponse({
    tx,
    context,
    input,
  }: MonitoringArgs): Promise<MonitoringAnswer> {
    const { applicationId } = input.params;
    await requireSubmitted(tx, applicationId);
    const row = await monitoringDb(tx)
      .selectFrom('grants.monitoring_response as m')
      .innerJoin('grants.form_version as f', 'f.id', 'm.form_version_id')
      .select([
        'm.form_version_id',
        'm.answers',
        'm.privacy_notice_version',
        'm.consent_given_at',
        'f.definition',
      ])
      .where('m.application_id', '=', applicationId)
      .executeTakeFirst();
    if (row === undefined) return { response: null };
    await context.audit.read({ action: 'grants.monitoring.read', entityId: applicationId });
    return {
      response: {
        formVersionId: row.form_version_id,
        answers: projectedAnswers(
          row.definition as FormDefinition,
          row.answers as Answers,
          'applicant',
        ),
        privacyNoticeVersion: row.privacy_notice_version,
        consentGivenAt: row.consent_given_at.toISOString(),
      },
    };
  }

  /** Withdrawing consent deletes the response, and is the only change; it works after the round closes. */
  async function withdrawMonitoringResponse({
    tx,
    context,
    input,
  }: MonitoringArgs): Promise<undefined> {
    const { applicationId } = input.params;
    await requireSubmitted(tx, applicationId);
    const removed = await monitoringDb(tx)
      .deleteFrom('grants.monitoring_response')
      .where('application_id', '=', applicationId)
      .returning(['id', 'privacy_notice_version'])
      .executeTakeFirst();
    if (removed === undefined) throw deps.notFound();
    await context.audit.record({
      action: 'grants.monitoring.withdrawn',
      entityId: applicationId,
      changes: {
        [column('id')]: { before: removed.id, after: null },
        [column('privacy_notice_version')]: { before: removed.privacy_notice_version, after: null },
      },
    });
    return undefined;
  }

  return { getMonitoringResponse, withdrawMonitoringResponse };
}
