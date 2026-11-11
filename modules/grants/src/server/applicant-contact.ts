// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who an application is from, for assure's duplicate flags (ADR 0016). Ids
// only: the organisation and the person who applied. Their names, contact
// details and identifiers are party's, which the caller reads through party's
// contract. It reads in the caller's tenant transaction, so another tenant's
// application is not there, and answers nothing while grants is switched off
// or for a draft, which is not yet the funder's to see.

import { applicationsDb } from './applications/tables.ts';
import type { Tx } from './programme/tables.ts';

export interface ApplicantContact {
  readonly applicationId: string;
  readonly organisationId: string;
  readonly applicantPersonId: string;
}

type Modules = { 'app.tenant_module': { module: string; enabled: boolean } };

export async function readApplicantContact(
  tx: Tx,
  applicationId: string,
): Promise<ApplicantContact | null> {
  const db = applicationsDb(tx).$extendTables<Modules>();
  const grants = await db
    .selectFrom('app.tenant_module')
    .select('enabled')
    .where('module', '=', 'grants')
    .executeTakeFirst();
  if (grants?.enabled !== true) return null;
  const application = await db
    .selectFrom('grants.application')
    .select(['id', 'organisation_id', 'applicant_person_id'])
    .where('id', '=', applicationId)
    .where('status', '<>', 'draft')
    .executeTakeFirst();
  return application === undefined
    ? null
    : {
        applicationId: application.id,
        organisationId: application.organisation_id,
        applicantPersonId: application.applicant_person_id,
      };
}
