// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's composition (ADR 0016, ADR 0031): its routes, jobs and
// erasure contribution, built from the platform's dependencies. Every handler
// runs in the request's transaction, so row-level security keeps each answer
// in the caller's tenant, and the platform has checked the module switch, the
// permission and the step-up window before it runs.
//
// Registry calls go out through the platform's outbound dispatcher; a register
// whose key is not set has no adapter and answers "not set up". Job payloads
// hold ids only (ADR 0009). Nothing here rejects, holds or decides anything
// about an application or a party: a match waits for a named member (rule 9).
//
// Not yet wired, each for want of a piece another owner holds: the sanctions
// list download (the platform has no scheduled module job, and the database
// has no `assure.load_reference_list()` loader yet), the screening of a
// person's own record and of an organisation's contacts (party's server has
// no name read the worker may use), and assure's subject data (the platform
// does not read a composition's `subjectData`).

import { createHash } from 'node:crypto';

import {
  assureRoutes,
  registrySchema,
  screeningMatchFound,
} from '@pixel-scientists/assure/contracts';
import {
  assureErasure,
  createRegistryAdapters,
  duplicateHandlers,
  REFRESH_QUEUE,
  registersOff,
  registryHandlers,
  registryRefresh,
  responseHandlers,
  SCREENING_QUEUE,
  screeningHandlers,
  screeningJob,
  submissionSubscriber,
  templateHandlers,
  visitHandlers,
  type PartyReader,
  type QueueRefresh,
} from '@pixel-scientists/assure/server';
import {
  defineEventHandler,
  defineQueue,
  JobError,
  publish,
  sendJob,
  type JobErrorCode,
  type Queue,
} from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { defineSubscriptions } from '@pixel-scientists/domain/events';
import { applicationSubmitted } from '@pixel-scientists/grants/contracts';
import { readApplicantContact } from '@pixel-scientists/grants/server';
import { registerRepoints } from '@pixel-scientists/party/contracts';
import { createPartyMerges, organisationName, partyRepoint } from '@pixel-scientists/party/server';
import { z } from 'zod';

import { recordAudit, type JobActor } from '../audit/writer.ts';
import { route, type Route } from '../routes/register.ts';
import type { ModuleJob } from '../worker/registry.ts';
import type { ModuleFactory } from './types.ts';

/**
 * The refresh queue (migration 0053): one identifier by `{ organisationId, registry }`, or the
 * platform fan-out's per-tenant scan by `{ slot }`. The job checks which of the two it was given.
 */
export const refreshQueue = defineQueue(
  REFRESH_QUEUE,
  'tenant',
  z.strictObject({
    slot: idSchema.optional(),
    organisationId: idSchema.optional(),
    registry: registrySchema.optional(),
  }),
);

/** The screening queue (migration 0055): one queued run, by id. */
export const screeningQueue = defineQueue(
  SCREENING_QUEUE,
  'tenant',
  z.strictObject({ runId: idSchema }),
);

/** The job as the audit trail names it: the system, with the job's id and the member whose request caused it. */
const actorOf = (job: {
  readonly id: string;
  readonly context: { readonly causingUserId: string | null };
}): JobActor => ({
  kind: 'job',
  jobId: job.id,
  originMembershipId: job.context.causingUserId,
});

/**
 * An organisation's own name, the same for a request and for the worker, which reads no more of
 * party's records. A person, and an organisation's contacts, are not screened until party's server
 * has a name read the worker may use.
 */
const party: PartyReader = {
  names: async (tx, partyId) => {
    const name = await organisationName(tx, partyId);
    return name === null ? null : [{ partyId, kind: 'organisation', name }];
  },
};

const fail = (code: JobErrorCode): Error => new JobError(code);

type By = Parameters<QueueRefresh>[2];

export const assureComposition: ModuleFactory = ({ jobs, log, outbound, platform, settings }) => {
  defineSubscriptions('assure', [applicationSubmitted.name]);

  const adapters = createRegistryAdapters(settings.assure.registryKeys, { fetch: outbound.fetch });
  const off = registersOff(adapters);
  if (off.length > 0) {
    log?.warn({ code: 'registers_off' }, `Registers not set up: ${off.join(', ')}.`);
  }

  const queueRefresh: QueueRefresh = (tx, data, by) =>
    sendJob(
      tx,
      refreshQueue,
      data,
      { sender: jobs, ...by },
      { singletonOn: ['organisationId', 'registry'] },
    );
  const queueScreening = (tx: Parameters<QueueRefresh>[0], data: { runId: string }, by: By) =>
    sendJob(tx, screeningQueue, data, { sender: jobs, ...by }, { singletonOn: ['runId'] });
  const auditAsJob: Parameters<typeof screeningJob>[0]['audit'] = (tx, job, event) =>
    recordAudit(tx, actorOf(job), event);

  const registry = registryHandlers({
    adapters,
    queueRefresh,
    notFound: platform.notFound,
    refuse: platform.refuse,
  });
  const screening = screeningHandlers({
    party,
    queueScreening,
    notFound: platform.notFound,
    refuse: platform.refuse,
  });
  const checklistDeps = {
    notFound: platform.notFound,
    refuse: platform.refuse,
    readApplicant: readApplicantContact,
  };
  const checklists = templateHandlers(checklistDeps);
  const responses = responseHandlers(checklistDeps);
  const visits = visitHandlers(checklistDeps);
  const duplicates = duplicateHandlers({
    notFound: platform.notFound,
    refuse: platform.refuse,
    parties: createPartyMerges({
      repoints: registerRepoints([partyRepoint]),
      notFound: platform.notFound,
    }),
    readApplicant: readApplicantContact,
    digest: (text) => createHash('sha256').update(text).digest('hex'),
  });

  const routes: Route[] = [
    route(assureRoutes.listOrganisationLookups, registry.listOrganisationLookups),
    // The first answer has no id of its own to read again, so a repeat answers as the queue does.
    route(assureRoutes.refreshOrganisationLookup, registry.refreshOrganisationLookup, {
      replay: () =>
        Promise.reject(platform.refuse(409, 'A lookup for this register is already queued.')),
    }),
    route(assureRoutes.listLookupOfficers, registry.listLookupOfficers),
    route(assureRoutes.linkLookupOfficer, registry.linkLookupOfficer),
    route(assureRoutes.startScreeningRun, screening.startScreeningRun, {
      replay: ({ tx, id }) => screening.replayScreeningRun({ tx, id }),
    }),
    route(assureRoutes.listScreeningRuns, screening.listScreeningRuns),
    route(assureRoutes.getScreeningRun, screening.getScreeningRun),
    route(assureRoutes.listScreeningMatches, screening.listScreeningMatches),
    route(assureRoutes.getScreeningMatch, screening.getScreeningMatch),
    route(assureRoutes.decideScreeningMatch, screening.decideScreeningMatch, {
      replay: ({ tx, id }) => screening.replayMatchDecision({ tx, id }),
    }),
    route(assureRoutes.listApplicationDuplicateFlags, duplicates.listApplicationDuplicateFlags),
    route(assureRoutes.listPartyDuplicateFlags, duplicates.listPartyDuplicateFlags),
    route(assureRoutes.dismissDuplicateFlag, duplicates.dismissDuplicateFlag),
    route(assureRoutes.listChecklists, checklists.listChecklists),
    route(assureRoutes.getChecklist, checklists.getChecklist),
    route(assureRoutes.createChecklist, checklists.createChecklist, {
      replay: ({ tx, id }) => checklists.replayChecklist({ tx, id: platform.created(id) }),
    }),
    route(assureRoutes.publishChecklistVersion, checklists.publishChecklistVersion, {
      replay: ({ tx, input }) => checklists.replayChecklist({ tx, id: input.params.checklistId }),
    }),
    route(assureRoutes.listApplicationChecklists, responses.listApplicationChecklists),
    route(assureRoutes.getChecklistResponse, responses.getChecklistResponse),
    route(assureRoutes.saveChecklistResponse, responses.saveChecklistResponse),
    route(assureRoutes.listVisits, visits.listVisits),
    route(assureRoutes.createVisit, visits.createVisit, {
      replay: ({ tx, id }) => visits.replayVisit({ tx, id: platform.created(id) }),
    }),
    route(assureRoutes.getVisit, visits.getVisit),
    route(assureRoutes.updateVisit, visits.updateVisit),
  ];

  const refresh = registryRefresh({
    adapters,
    queueRefresh,
    audit: (tx, job, event) => recordAudit(tx, actorOf(job), event),
    fail,
  });
  const run = screeningJob({
    party,
    audit: auditAsJob,
    publishMatchFound: (tx, data, by) =>
      publish(tx, screeningMatchFound, data, {
        sender: jobs,
        requestId: by.requestId,
        causingUserId: by.causingUserId,
        causedBy: by.causingUserId,
      }),
    fail,
  });
  const submitted = defineEventHandler(
    'assure',
    submissionSubscriber({ party, queueScreening, audit: auditAsJob, fail }),
  );

  const moduleJobs: ModuleJob[] = [
    { queue: refreshQueue, handler: (trx, job) => refresh(trx, job) },
    { queue: screeningQueue, handler: (trx, job) => run(trx, job) },
    {
      // The event queue is always a tenant queue; defineEventHandler parses the event and checks its tenant.
      queue: submitted.queue as Queue<z.ZodObject, 'tenant'>,
      handler: (trx, job) => submitted.handle(trx, job),
    },
  ];

  return { routes, jobs: moduleJobs, erasure: [assureErasure] };
};
