// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's composition (ADR 0016): its routes and its erasure
// contribution, built from the platform's dependencies. Every handler runs in
// the request's transaction, so row-level security keeps each answer in the
// caller's tenant, and the platform has checked the module switch, the
// permission and the step-up window before it runs. The module's audit rules
// reach the audit log through `context.ts`, which the platform reads.
//
// Erasure from a request starts the platform's own erasure (the same handlers
// as POST /console/erasure-requests), as the session's member in the request's
// transaction. Not yet wired, each for want of a piece another owner holds: the
// export start and status routes (the platform has no subject access request
// handler or export job yet) and the consent history route (party has no
// consent history read in its server contract).

import { privacyRoutes as routes, subjectActionRoutes } from '@pixel-scientists/privacy/contracts';
import {
  privacyErasure,
  privacyHandlers,
  type SubjectRights,
} from '@pixel-scientists/privacy/server';

import type { MemberContext } from '../context.ts';
import type { TenantTransaction } from '../database.ts';
import { readErasureRequestHandler, requestErasureHandler } from '../platform/erasure/request.ts';
import { ApiError } from '../problems.ts';
import { route } from '../routes/register.ts';
import type { ModuleFactory } from './types.ts';

const notBuilt = (what: string) => (): Promise<never> =>
  Promise.reject(new Error(`${what} is not built yet.`));

/**
 * The module composed with `now` as the server clock every deadline is judged
 * by, so a test can fix it. Bank holidays have no tenant source on main, so
 * only weekends move a due date.
 */
export const privacyCompositionAt =
  (now: () => Date): ModuleFactory =>
  ({ platform, jobs }) => {
    const handlers = privacyHandlers({
      notFound: platform.notFound,
      refuse: platform.refuse,
      tenantTimeZone: platform.tenantTimeZone,
      now,
      nonWorkingDates: () => Promise.resolve(new Set()),
    });
    const startErasure = requestErasureHandler(jobs);

    /** The platform's erasure, asked for the request's subject by the session's member. */
    const withRights = (tx: TenantTransaction, context: MemberContext) => {
      const subjectRights: SubjectRights = {
        startExport: notBuilt('The subject access export'),
        exportStatus: notBuilt('The subject access export status'),
        consentHistory: notBuilt("A person's consent history"),
        startErasure: async (personId) =>
          (
            await startErasure({
              tx,
              context,
              input: { body: { partyId: personId, reason: 'subject_request', confirm: true } },
            })
          ).requestId,
        erasureStatus: async (requestId) => {
          try {
            return await readErasureRequestHandler({
              tx,
              context,
              input: { params: { requestId } },
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          }
        },
      };
      return { ...context, subjectRights };
    };

    return {
      routes: [
        route(routes.listRightsRequests, handlers.listRightsRequests),
        route(routes.createRightsRequest, handlers.createRightsRequest, {
          replay: handlers.replayRequest,
        }),
        route(routes.getRightsRequest, handlers.getRightsRequest),
        route(routes.updateRightsRequest, handlers.updateRightsRequest),
        route(routes.pauseRightsRequest, handlers.pauseRightsRequest, {
          replay: handlers.replayRequest,
        }),
        route(routes.resumeRightsRequest, handlers.resumeRightsRequest, {
          replay: handlers.replayRequest,
        }),
        route(routes.extendRightsRequest, handlers.extendRightsRequest, {
          replay: handlers.replayRequest,
        }),
        route(routes.closeRightsRequest, handlers.closeRightsRequest, {
          replay: handlers.replayRequest,
        }),
        route(routes.listRequestTasks, handlers.listRequestTasks),
        route(routes.createRequestTask, handlers.createRequestTask, {
          replay: handlers.replayRequestTask,
        }),
        route(routes.updateRequestTask, handlers.updateRequestTask),
        route(routes.completeRequestTask, handlers.completeRequestTask, {
          replay: handlers.replayRequestTask,
        }),
        route(
          subjectActionRoutes.startRequestErasure,
          ({ tx, context, input }) =>
            handlers.startRequestErasure({ tx, context: withRights(tx, context), input }),
          { replay: handlers.replayStartRequestErasure },
        ),
        route(subjectActionRoutes.getRequestErasure, ({ tx, context, input }) =>
          handlers.getRequestErasure({ tx, context: withRights(tx, context), input }),
        ),
        route(routes.listBreaches, handlers.listBreaches),
        route(routes.createBreach, handlers.createBreach, { replay: handlers.replayCreatedBreach }),
        route(routes.getBreach, handlers.getBreach),
        route(routes.updateBreach, handlers.updateBreach),
        route(routes.assessBreach, handlers.assessBreach, { replay: handlers.replayAssessment }),
        route(routes.recordIcoNotification, handlers.recordIcoNotification, {
          replay: handlers.replayBreach,
        }),
        route(routes.recordSubjectNotification, handlers.recordSubjectNotification, {
          replay: handlers.replayBreach,
        }),
        route(routes.listDpias, handlers.listDpias),
        route(routes.createDpia, handlers.createDpia, { replay: handlers.replayDpia }),
        route(routes.getDpia, handlers.getDpia),
        route(routes.updateDpia, handlers.updateDpia),
        route(routes.signOffDpia, handlers.signOffDpia, { replay: handlers.replayDpia }),
        route(routes.getProcessingRecord, handlers.getProcessingRecord),
        route(routes.listProcessingActivities, handlers.listProcessingActivities),
        route(routes.createProcessingActivity, handlers.createProcessingActivity, {
          replay: handlers.replayActivity,
        }),
        route(routes.getProcessingActivity, handlers.getProcessingActivity),
        route(routes.updateProcessingActivity, handlers.updateProcessingActivity),
        route(routes.listProcessors, handlers.listProcessors),
        route(routes.createProcessor, handlers.createProcessor, {
          replay: handlers.replayProcessor,
        }),
        route(routes.updateProcessor, handlers.updateProcessor),
      ],
      erasure: [privacyErasure],
    };
  };

export const privacyComposition: ModuleFactory = privacyCompositionAt(() => new Date());
