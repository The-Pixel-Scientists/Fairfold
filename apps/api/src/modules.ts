// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Composes the modules (ADR 0016): each module's routes, matched with their
// contracts, its scope rule resolvers, and any platform dependency the module
// declares. A module never imports from this app; the platform reaches it
// only through its server entry point.

import type { FieldProblem } from '@pixel-scientists/domain/platform';
import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import {
  applicationRoutes,
  FORM_DEFINITION_MAX_BYTES,
  formRoutes,
  programmeRoutes,
} from '@pixel-scientists/grants/contracts';
import { grantsHandlers, grantsResolvers } from '@pixel-scientists/grants/server';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { partyHandlers, partyResolvers } from '@pixel-scientists/party/server';

import type { PublicTenants, TenantTransaction } from './database.ts';
import { listAuditEventsHandler } from './platform/audit-log/index.ts';
import { insertConfigVersion, readConfigHistory } from './platform/config-versions.ts';
import { settingsRoutes } from './platform/settings/index.ts';
import { settingsTables } from './platform/settings/tables.ts';
import type { ScopeResolvers } from './policy/index.ts';
import { ApiError } from './problems.ts';
import { publicRoutes } from './public/index.ts';
import { route, type Route } from './routes/register.ts';

export interface ComposedModules {
  readonly routes: readonly Route[];
  readonly resolvers: ScopeResolvers;
}

/** Room for a definition at its limit, written with spaces, in a request; the contract's schema checks the size itself. */
const FORM_BODY_LIMIT_BYTES = 2 * FORM_DEFINITION_MAX_BYTES;

/** A record the caller may not reach reads exactly as a missing one does. */
const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });

/** A request the caller can fix or retry, in words that show nothing they sent. */
const refuse = (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]): Error =>
  new ApiError(status, detail, { errors, reason: 'refused' });

const tenantTimeZone = async (tx: TenantTransaction, tenant: string): Promise<string> =>
  (
    await settingsTables(tx)
      .selectFrom('app.tenant')
      .select('timezone')
      .where('id', '=', tenant)
      .executeTakeFirstOrThrow()
  ).timezone;

export function composeModules(deps: { publicTenants: PublicTenants }): ComposedModules {
  const party = partyHandlers({ notFound });
  const grants = grantsHandlers({
    notFound,
    refuse,
    tenantTimeZone,
    recordConfig: insertConfigVersion,
    configHistory: readConfigHistory,
  });
  return {
    routes: [
      route(listAuditEvents, listAuditEventsHandler),
      ...settingsRoutes,
      ...publicRoutes(deps.publicTenants),
      route(partyRoutes.getProfile, party.getProfile),
      route(partyRoutes.updateProfile, party.updateProfile),
      route(partyRoutes.recordConsent, party.recordConsent),
      route(partyRoutes.listMyOrganisations, party.listMyOrganisations),
      route(partyRoutes.createOrganisation, party.createOrganisation),
      route(partyRoutes.getMyOrganisation, party.getMyOrganisation),
      route(partyRoutes.updateMyOrganisation, party.updateMyOrganisation),
      route(partyRoutes.listOrganisations, party.listOrganisations),
      route(partyRoutes.getOrganisation, party.getOrganisation),
      route(partyRoutes.getPerson, party.getPerson),
      route(programmeRoutes.listProgrammes, grants.listProgrammes),
      route(programmeRoutes.createProgramme, grants.createProgramme),
      route(programmeRoutes.getProgramme, grants.getProgramme),
      route(programmeRoutes.updateProgramme, grants.updateProgramme),
      route(programmeRoutes.listRounds, grants.listRounds),
      route(programmeRoutes.createRound, grants.createRound),
      route(programmeRoutes.getRound, grants.getRound),
      route(programmeRoutes.updateRound, grants.updateRound),
      route(programmeRoutes.listStages, grants.listStages),
      route(programmeRoutes.setStages, grants.setStages),
      route(programmeRoutes.setRubric, grants.setRubric),
      route(programmeRoutes.getEmailTemplates, grants.getEmailTemplates),
      route(programmeRoutes.setEmailTemplates, grants.setEmailTemplates),
      route(programmeRoutes.getProgrammeHistory, grants.getProgrammeHistory),
      route(programmeRoutes.getRoundHistory, grants.getRoundHistory),
      route(formRoutes.listFormVersions, grants.listFormVersions),
      route(formRoutes.createFormDraft, grants.createFormDraft),
      route(formRoutes.getFormVersion, grants.getFormVersion),
      route(formRoutes.saveFormDraft, grants.saveFormDraft, { bodyLimit: FORM_BODY_LIMIT_BYTES }),
      route(formRoutes.publishFormDraft, grants.publishFormDraft),
      route(formRoutes.discardFormDraft, grants.discardFormDraft),
      route(applicationRoutes.listOpenRounds, grants.listOpenRounds),
      route(applicationRoutes.getOpenRound, grants.getOpenRound),
      route(applicationRoutes.startApplication, grants.startApplication),
      route(applicationRoutes.listApplications, grants.listApplications),
      route(applicationRoutes.getApplication, grants.getApplication),
      route(applicationRoutes.saveApplicationAnswers, grants.saveApplicationAnswers),
      route(applicationRoutes.checkApplicationEligibility, grants.checkApplicationEligibility),
      route(applicationRoutes.submitApplication, grants.submitApplication),
      route(applicationRoutes.withdrawApplication, grants.withdrawApplication),
    ],
    resolvers: { ...partyResolvers, ...grantsResolvers },
  };
}
