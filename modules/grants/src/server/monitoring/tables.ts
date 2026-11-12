// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables this folder reads, with the columns it uses (migration 0051).
// Only this folder names `grants.monitoring_response` (ADR 0032). Inserts take
// `tenant_id` from `app.current_tenant_id()`, never from a value.

import type { Tx } from '../programme/tables.ts';

type MonitoringTables = {
  'grants.monitoring_response': {
    id: string;
    round_id: string;
    application_id: string;
    form_version_id: string;
    answers: unknown;
    privacy_notice_version: string;
    consent_given_at: Date;
  };
  'grants.form_version': { id: string; definition: unknown };
  'grants.application': { id: string; status: string };
  'grants.round': { id: string; closes_at: Date };
  'grants.adjustment': {
    round_id: string;
    organisation_id: string;
    application_id: string | null;
    kind: 'deadline_extension' | 'alternative_route';
    closes_at: Date | null;
    revoked_at: Date | null;
  };
  'app.tenant_module': { module: string; enabled: boolean };
};

/** The transaction typed to the tables the monitoring code uses. */
export function monitoringDb(tx: Tx) {
  return tx.$extendTables<MonitoringTables>();
}
