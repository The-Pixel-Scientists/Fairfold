// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the board pack routes and job use, with the columns they read.
// The job runs as app_worker, which reads only the columns migrations 0029,
// 0044 and 0045 grant it. Writes go through the job request's status columns
// alone.

import type { Outcome } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';

type JobRequestStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

type Tables = {
  'grants.application': {
    id: string;
    round_id: string;
    form_version_id: string;
    organisation_snapshot_id: string | null;
    status: string;
    answers: unknown;
    submitted_at: Date | null;
  };
  'grants.round': { id: string; programme_id: string; title: string };
  'grants.programme': { id: string; title: string };
  'grants.form_version': { id: string; definition: unknown };
  'grants.decision': {
    application_id: string;
    outcome: Outcome;
    amount_minor: string | null;
    released_at: Date | null;
  };
  'app.membership': { id: string; roles: string[]; status: string };
  'app.tenant_module': { module: string; enabled: boolean };
  'app.job_request': {
    id: string;
    kind: string;
    requested_by: string;
    filters: unknown;
    field_ids: string[];
    status: JobRequestStatus;
    failure_code: string | null;
    output_file_id: string | null;
    requested_at: Date;
    expires_at: Date | null;
  };
};

export const boardPackDb = (tx: Tx) => tx.$extendTables<Tables>();
