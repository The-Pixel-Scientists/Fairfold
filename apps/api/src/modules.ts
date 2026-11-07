// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Composes the modules (ADR 0016): each module's routes, matched with their
// contracts, its scope rule resolvers, and any platform dependency the module
// declares. A module never imports from this app; the platform reaches it
// only through its server entry point.

import type { FieldProblem } from '@pixel-scientists/domain/platform';
import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import { getWarehouseSnapshot } from '@pixel-scientists/domain/warehouse';
import {
  applicationRoutes,
  assessmentRoutes,
  assignReviewersAutomatically,
  attachmentRoutes,
  decisionRoutes,
  exportRoutes,
  FORM_DEFINITION_MAX_BYTES,
  formRoutes,
  programmeRoutes,
  reviewRoutes,
  spreadRoutes,
  submissionRoutes,
} from '@pixel-scientists/grants/contracts';
import {
  grantsHandlers,
  grantsResolvers,
  grantsWarehouse,
  type MailSender,
} from '@pixel-scientists/grants/server';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { partyHandlers, partyResolvers, partyWarehouse } from '@pixel-scientists/party/server';

import type { PublicTenants, TenantTransaction } from './database.ts';
import { listAuditEventsHandler } from './platform/audit-log/index.ts';
import { insertConfigVersion, readConfigHistory } from './platform/config-versions.ts';
import { membersWith } from './platform/members.ts';
import { settingsRoutes } from './platform/settings/index.ts';
import { settingsTables } from './platform/settings/tables.ts';
import { teamRoutes, type TeamAuth } from './platform/team/index.ts';
import { warehouseSnapshotHandler } from './platform/warehouse/index.ts';
import type { ScopeResolvers } from './policy/index.ts';
import { ApiError } from './problems.ts';
import { publicRoutes } from './public/index.ts';
import type { PublicLog } from './public/tenants.ts';
import { route, type Route } from './routes/register.ts';
import type { ModuleJob } from './worker/registry.ts';

/** What the platform reads from a module's server entry point besides its routes. */
export interface ModuleServer {
  readonly jobs?: readonly ModuleJob[];
}

/**
 * The jobs of every registered module server, whether or not a tenant has the
 * module on: each handler checks its module inside the tenant transaction. A
 * queue two modules both define stops start-up.
 */
export function collectModuleJobs(servers: readonly ModuleServer[]): readonly ModuleJob[] {
  const jobs = servers.flatMap((server) => server.jobs ?? []);
  const names = new Set<string>();
  for (const { queue } of jobs) {
    if (names.has(queue.name)) throw new Error(`The queue ${queue.name} is defined twice.`);
    names.add(queue.name);
  }
  return jobs;
}

export interface ComposedModules {
  readonly routes: readonly Route[];
  readonly resolvers: ScopeResolvers;
}

/** Room for a definition at its limit, written with spaces, in a request; the contract's schema checks the size itself. */
const FORM_BODY_LIMIT_BYTES = 2 * FORM_DEFINITION_MAX_BYTES;

/** A record the caller may not reach reads exactly as a missing one does. */
const notFound = (): Error => new ApiError(404, undefined, { reason: 'not_found' });
const missing = (): never => {
  throw notFound();
};

/** A request the caller can fix or retry, in words that show nothing they sent. */
const refuse = (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]): Error =>
  new ApiError(status, detail, { errors, reason: 'refused' });

/** The id a replay reads by; a route whose first answer had none has nothing to replay. */
const created = (id: string | null): string => id ?? missing();

const tenantTimeZone = async (tx: TenantTransaction, tenant: string): Promise<string> =>
  (
    await settingsTables(tx)
      .selectFrom('app.tenant')
      .select('timezone')
      .where('id', '=', tenant)
      .executeTakeFirstOrThrow()
  ).timezone;

/** What a module that sends email needs: the sender, and the portal origin its emails link to. */
export interface Mail {
  readonly sender: MailSender;
  readonly portalOrigin: string;
}

/** For callers that send no email: every send fails with a code, and nothing leaves the process. */
const noMail: Mail = {
  sender: { send: () => Promise.resolve({ sent: false, code: 'connection_failed' }) },
  portalOrigin: 'https://portal.invalid',
};

/** For callers with no auth module: the team routes fail, and nothing is invited or signed out. */
const missingAuth = (): Promise<never> =>
  Promise.reject(new Error('The API was built without the auth module.'));
const noAuth: TeamAuth = {
  createInvitation: missingAuth,
  revokeSessionsForMembership: missingAuth,
};

export function composeModules(deps: {
  publicTenants: PublicTenants;
  /** The auth module, for the team routes. */
  auth?: TeamAuth;
  mail?: Mail;
  log?: PublicLog;
}): ComposedModules {
  const party = partyHandlers({ notFound });
  const grants = grantsHandlers({
    notFound,
    refuse,
    tenantTimeZone,
    recordConfig: insertConfigVersion,
    configHistory: readConfigHistory,
    membersWith,
    ...(deps.mail ?? noMail),
  });
  return {
    routes: [
      route(listAuditEvents, listAuditEventsHandler),
      ...teamRoutes(deps.auth ?? noAuth),
      ...settingsRoutes,
      route(
        getWarehouseSnapshot,
        warehouseSnapshotHandler({ contributions: [partyWarehouse, grantsWarehouse] }),
      ),
      ...publicRoutes(deps.publicTenants, deps.log),
      route(partyRoutes.getProfile, party.getProfile),
      route(partyRoutes.updateProfile, party.updateProfile),
      route(partyRoutes.recordConsent, party.recordConsent, {
        // A consent has no id: replay answers the person's current consent for the same purpose and channel.
        replay: async ({ tx, context, input }) => {
          const { consents } = await party.getProfile({ tx, context, input: {} });
          const kind = (c: { purpose: string; channel: string }) => `${c.purpose}:${c.channel}`;
          return consents.find((c) => kind(c) === kind(input.body)) ?? missing();
        },
      }),
      route(partyRoutes.listMyOrganisations, party.listMyOrganisations),
      route(partyRoutes.createOrganisation, party.createOrganisation, {
        // The create route's scope always passes, so apply the read route's: a caller who is no
        // longer a current contact reads 404, as the GET would.
        replay: async ({ tx, context, id }) => {
          const params = { organisationId: created(id) };
          const allowed = await partyResolvers.own_organisation({
            tx,
            userId: context.session.userId,
            input: { params },
          });
          return allowed ? party.getMyOrganisation({ tx, context, input: { params } }) : missing();
        },
      }),
      route(partyRoutes.getMyOrganisation, party.getMyOrganisation),
      route(partyRoutes.updateMyOrganisation, party.updateMyOrganisation),
      route(partyRoutes.listOrganisations, party.listOrganisations),
      route(partyRoutes.getOrganisation, party.getOrganisation),
      route(partyRoutes.getPerson, party.getPerson),
      route(programmeRoutes.listProgrammes, grants.listProgrammes),
      route(programmeRoutes.createProgramme, grants.createProgramme, {
        replay: ({ tx, context, id }) =>
          grants.getProgramme({ tx, context, input: { params: { programmeId: created(id) } } }),
      }),
      route(programmeRoutes.getProgramme, grants.getProgramme),
      route(programmeRoutes.updateProgramme, grants.updateProgramme),
      route(programmeRoutes.listRounds, grants.listRounds),
      route(programmeRoutes.createRound, grants.createRound, {
        replay: ({ tx, context, id }) =>
          grants.getRound({ tx, context, input: { params: { roundId: created(id) } } }),
      }),
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
      route(formRoutes.createFormDraft, grants.createFormDraft, {
        replay: ({ tx, context, id }) =>
          grants.getFormVersion({
            tx,
            context,
            input: { params: { formVersionId: created(id) } },
          }),
      }),
      route(formRoutes.getFormVersion, grants.getFormVersion),
      route(formRoutes.saveFormDraft, grants.saveFormDraft, { bodyLimit: FORM_BODY_LIMIT_BYTES }),
      route(formRoutes.publishFormDraft, grants.publishFormDraft),
      route(formRoutes.discardFormDraft, grants.discardFormDraft),
      route(applicationRoutes.listOpenRounds, grants.listOpenRounds),
      route(applicationRoutes.getOpenRound, grants.getOpenRound),
      route(applicationRoutes.startApplication, grants.startApplication, {
        replay: ({ tx, context, id }) =>
          grants.getApplication({
            tx,
            context,
            input: { params: { applicationId: created(id) } },
          }),
      }),
      route(applicationRoutes.listApplications, grants.listApplications),
      route(applicationRoutes.getApplication, grants.getApplication),
      route(applicationRoutes.saveApplicationAnswers, grants.saveApplicationAnswers),
      route(applicationRoutes.checkApplicationEligibility, grants.checkApplicationEligibility),
      route(applicationRoutes.submitApplication, grants.submitApplication),
      route(applicationRoutes.withdrawApplication, grants.withdrawApplication),
      route(attachmentRoutes.uploadAttachment, grants.uploadAttachment, {
        replay: async ({ tx, context, input, id }) =>
          (
            await grants.listAttachments({ tx, context, input: { params: input.params } })
          ).attachments.find((a) => a.id === id) ?? missing(),
      }),
      route(attachmentRoutes.listAttachments, grants.listAttachments),
      route(attachmentRoutes.removeAttachment, grants.removeAttachment),
      route(attachmentRoutes.downloadAttachment, grants.downloadAttachment),
      route(attachmentRoutes.listSubmissionAttachments, grants.listSubmissionAttachments),
      route(attachmentRoutes.downloadSubmissionAttachment, grants.downloadSubmissionAttachment),
      route(submissionRoutes.listSubmissions, grants.listSubmissions),
      route(submissionRoutes.getSubmission, grants.getSubmission),
      route(submissionRoutes.moveSubmissionsToStage, grants.moveSubmissionsToStage),
      route(assessmentRoutes.getReviewerPool, grants.getReviewerPool),
      route(assessmentRoutes.listReviewerCandidates, grants.listReviewerCandidates),
      route(assessmentRoutes.addReviewers, grants.addReviewers),
      route(assessmentRoutes.removeReviewer, grants.removeReviewer),
      route(assessmentRoutes.listAssignments, grants.listAssignments),
      route(assessmentRoutes.assignReviewers, grants.assignReviewers),
      route(assessmentRoutes.removeAssignment, grants.removeAssignment),
      route(assignReviewersAutomatically, grants.assignReviewersAutomatically),
      route(spreadRoutes.getScoreSpread, grants.getScoreSpread),
      route(spreadRoutes.getSubmissionScores, grants.getSubmissionScores),
      route(reviewRoutes.listReviews, grants.listReviews),
      route(reviewRoutes.getReview, grants.getReview),
      route(reviewRoutes.declareConflict, grants.declareConflict),
      route(reviewRoutes.saveReviewScores, grants.saveReviewScores),
      route(reviewRoutes.submitReview, grants.submitReview),
      route(decisionRoutes.listDecisions, grants.listDecisions),
      route(decisionRoutes.recordDecision, grants.recordDecision),
      route(decisionRoutes.recordDecisions, grants.recordDecisions),
      route(decisionRoutes.previewDecisionEmail, grants.previewDecisionEmail),
      route(decisionRoutes.releaseDecisions, grants.releaseDecisions),
      route(decisionRoutes.sendDecisionEmails, grants.sendDecisionEmails),
      route(exportRoutes.getPublisherSetting, grants.getPublisherSetting),
      route(exportRoutes.savePublisherSetting, grants.savePublisherSetting),
      route(exportRoutes.get360GivingExport, grants.get360GivingExport),
    ],
    resolvers: { ...partyResolvers, ...grantsResolvers },
  };
}
