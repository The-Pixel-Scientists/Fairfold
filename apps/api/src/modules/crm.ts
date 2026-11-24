// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's composition (ADR 0016): its routes and its erasure
// contribution, built from the platform's dependencies. Every handler runs in
// the request's transaction, so row-level security keeps each answer in the
// caller's tenant, and the platform has checked the module switch, the
// permission and the step-up window before it runs.
//
// Not yet wired, each for want of a piece another owner holds: the merge
// reversal (party's merge contract has no unmerge, and the schema has no
// record of the rows a merge moved), the import
// routes and their parse job (the file service has no clean-only read for a
// job, and party has no duplicate check or staff create for a record that
// does not exist yet), the timeline's event handler (grants has no read
// contract for an application or a released decision), crm's subject data
// (the platform does not read a composition's `subjectData`), and the merge
// routes' other re-points (only party's and crm's are built).

import { createHash, createHmac } from 'node:crypto';

import { crmRoutes } from '@pixel-scientists/crm/contracts';
import { crmErasure, crmHandlers, crmRepoint } from '@pixel-scientists/crm/server';
import { attempt } from '@pixel-scientists/db';
import { registerRepoints } from '@pixel-scientists/party/contracts';
import { createPartyMerges, partyReadsForCrm, partyRepoint } from '@pixel-scientists/party/server';

import { route, type Route } from '../routes/register.ts';
import type { ModuleFactory } from './types.ts';

export const crmComposition: ModuleFactory = ({ platform, settings }) => {
  const { previewSecret } = settings.crm ?? {};
  const handlers = crmHandlers({
    notFound: platform.notFound,
    refuse: platform.refuse,
    parties: partyReadsForCrm,
    merges: createPartyMerges({
      repoints: registerRepoints([partyRepoint, crmRepoint]),
      notFound: platform.notFound,
    }),
    attempt,
    signPreview: (text) => {
      if (previewSecret === undefined) throw new Error('The merge preview secret is not set.');
      return createHmac('sha256', previewSecret.reveal()).update(text).digest('base64url');
    },
    digest: (text) => createHash('sha256').update(text).digest('hex'),
  });

  const routes: Route[] = [
    route(crmRoutes.searchParties, handlers.searchParties),
    route(crmRoutes.getOrganisationRecord, handlers.getOrganisationRecord),
    route(crmRoutes.getPersonRecord, handlers.getPersonRecord),
    route(crmRoutes.getTimeline, handlers.getTimeline),
    route(crmRoutes.recordInteraction, handlers.recordInteraction, {
      replay: ({ tx, id }) => handlers.replayInteraction({ tx, id: platform.created(id) }),
    }),
    route(crmRoutes.listDuplicates, handlers.listDuplicates),
    route(crmRoutes.listPartyDuplicates, handlers.listPartyDuplicates),
    route(crmRoutes.dismissDuplicate, handlers.dismissDuplicate, {
      replay: ({ tx, id }) => handlers.replayDismissal({ tx, id: platform.created(id) }),
    }),
    route(crmRoutes.getMergeRecord, handlers.getMergeRecord),
    route(crmRoutes.listPartyMerges, handlers.listPartyMerges),
    route(crmRoutes.listExternalReferences, handlers.listExternalReferences),
    route(crmRoutes.addExternalReference, handlers.addExternalReference, {
      replay: ({ tx, id }) => handlers.replayReference({ tx, id: platform.created(id) }),
    }),
    route(crmRoutes.removeExternalReference, handlers.removeExternalReference),
    route(crmRoutes.listLists, handlers.listLists),
    route(crmRoutes.createList, handlers.createList, {
      replay: ({ tx, id }) => handlers.replayList({ tx, id: platform.created(id) }),
    }),
    route(crmRoutes.updateList, handlers.updateList),
    route(crmRoutes.archiveList, handlers.archiveList),
    route(crmRoutes.listMembers, handlers.listMembers),
    // A repeat changes nothing, which is what a replay answers: nothing was changed again.
    route(crmRoutes.addMembers, handlers.addMembers, {
      replay: ({ input }) => Promise.resolve({ changed: 0, unchanged: input.body.partyIds.length }),
    }),
    route(crmRoutes.removeMembers, handlers.removeMembers, {
      replay: ({ input }) => Promise.resolve({ changed: 0, unchanged: input.body.partyIds.length }),
    }),
    route(crmRoutes.listSegments, handlers.listSegments),
    route(crmRoutes.getSegment, handlers.getSegment),
    route(crmRoutes.createSegment, handlers.createSegment, {
      replay: ({ tx, context, id }) =>
        handlers.getSegment({
          tx,
          context,
          input: { params: { segmentId: platform.created(id) } },
        }),
    }),
    route(crmRoutes.updateSegment, handlers.updateSegment),
    route(crmRoutes.archiveSegment, handlers.archiveSegment),
    route(crmRoutes.segmentMembers, handlers.segmentMembers),
  ];

  // Merging signs its preview, so a server without the secret has no merge route.
  if (previewSecret !== undefined) {
    routes.push(
      route(crmRoutes.previewMerge, handlers.previewMerge),
      route(crmRoutes.confirmMerge, handlers.confirmMerge, {
        replay: ({ tx, context, id }) =>
          handlers.getMergeRecord({
            tx,
            context,
            input: { params: { mergeRecordId: platform.created(id) } },
          }),
      }),
    );
  }

  return { routes, erasure: [crmErasure] };
};
