// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants tables the note and message handlers use (migration 0052 and the
// tables it refers to). Inserts take `tenant_id` from `app.current_tenant_id()`,
// the transaction's own tenant, never from a value.

import type { ApplicationStatus, DecisionEmailErrorCode } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type NoteTables = {
  'grants.application': {
    id: string;
    round_id: string;
    applicant_person_id: string;
    status: ApplicationStatus;
  };
  'grants.round': { id: string; programme_id: string };
  'grants.email_template_version': {
    id: string;
    programme_id: string;
    outcome: string;
    version: number;
  };
  'grants.application_note': { tenant_id: string; note_id: string; application_id: string };
  'grants.application_message': { tenant_id: string; application_id: string; thread_id: string };
  'grants.message_notification': {
    id: Generated<string>;
    tenant_id: string;
    message_id: string;
    recipient_person_id: string | null;
    template_version_id: string;
    status: Generated<'queued' | 'sent' | 'failed'>;
    error_code: Generated<DecisionEmailErrorCode | null>;
    sent_at: Generated<Date | null>;
  };
  'app.message': { id: string; thread_id: string };
  'app.tenant_module': { module: string; enabled: boolean };
};

export const noteDb = (tx: Tx) => tx.$extendTables<NoteTables>();
