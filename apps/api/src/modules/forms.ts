// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's composition (ADR 0016): its routes, scope rules, jobs and
// contributions, built from the platform's dependencies. The staff routes for
// forms, drafts, versions and templates, the staff and portal routes for
// responses and the anonymous routes are here; their SQL is in
// forms-store.ts and forms-responses-store.ts, which the module's handlers
// read and write through, and forms-public.ts, which calls the database's two
// approved functions.
//
// The anonymous routes and the lookup by reference need the two server keys,
// so a server without them has neither. Not yet wired, each for want of a
// piece another owner holds: the warehouse contribution (the warehouse has no
// forms table), forms' subject data (the platform does not read a
// composition's `subjectData`, though `formsSubjectData` is built), and the
// database function `forms.public_form()`, which the anonymous routes call
// and no migration creates yet.

import {
  consoleResponseRoutes,
  createForm,
  createFormFromTemplate,
  FORM_DEFINITION_MAX_BYTES,
  getFeedbackTemplate,
  getForm,
  getFormDraft,
  getFormVersion,
  listFeedbackTemplates,
  listForms,
  listFormVersions,
  portalFormRoutes,
  previewFormDraft,
  publishForm,
  publicFormRoutes,
  saveFormDraft,
  updateFormRetention,
  updateFormSettings,
} from '@pixel-scientists/forms/contracts';
import {
  formsPublicHandlers,
  formsResolvers,
  formsResponseHandlers,
  formsStaffHandlers,
} from '@pixel-scientists/forms/server';
import { ensurePersonForUser } from '@pixel-scientists/party/server';

import type { MemberContext } from '../context.ts';
import type { TenantTransaction } from '../database.ts';
import { route, type Route } from '../routes/register.ts';
import { formsPublicDependencies, publicProblems } from './forms-public.ts';
import { formsResponseStore } from './forms-responses-store.ts';
import { formsStore } from './forms-store.ts';
import { formsErasure } from './forms-subject.ts';
import type { ModuleFactory } from './types.ts';

/** Room for a definition at its limit, written with spaces, in a request; the contract's schema checks the size itself. */
const DRAFT_BODY_LIMIT_BYTES = 2 * FORM_DEFINITION_MAX_BYTES;

export const formsComposition: ModuleFactory = ({ database, log, platform, settings }) => {
  const staff = formsStaffHandlers<TenantTransaction>({
    notFound: platform.notFound,
    refuse: platform.refuse,
    store: formsStore,
  });
  /** A replay answers the form the first request made, as the form now reads. */
  const readForm = ({
    tx,
    context,
    id,
  }: {
    tx: TenantTransaction;
    context: MemberContext;
    id: string | null;
  }) => staff.getForm({ tx, context, input: { params: { formId: platform.created(id) } } });

  const keys = settings.forms;
  const responses = formsResponseHandlers<TenantTransaction>({
    notFound: platform.notFound,
    refuse: platform.refuse,
    formChanged: publicProblems.form_changed,
    store: formsResponseStore,
    hashKey: keys === undefined ? undefined : Buffer.from(keys.hashKey.reveal(), 'utf8'),
    ensurePerson: ensurePersonForUser,
  });
  const responseRoutes: Route[] = [
    route(consoleResponseRoutes.listResponses, responses.listResponses),
    route(consoleResponseRoutes.getResponseTotals, responses.getResponseTotals),
    route(consoleResponseRoutes.getResponse, responses.getResponse),
    route(consoleResponseRoutes.markResponseSpam, responses.markResponseSpam),
    route(consoleResponseRoutes.unmarkResponseSpam, responses.unmarkResponseSpam),
    route(portalFormRoutes.getPortalForm, responses.getPortalForm),
    route(portalFormRoutes.getMyFormDraft, responses.getMyFormDraft),
    route(portalFormRoutes.saveMyFormDraft, responses.saveMyFormDraft),
    route(portalFormRoutes.submitMyResponse, responses.submitMyResponse, {
      replay: ({ tx, context, input, id }) =>
        responses.replaySubmission({ tx, context, input, id: platform.created(id) }),
    }),
    route(portalFormRoutes.listMyResponses, responses.listMyResponses),
    route(portalFormRoutes.getMyResponse, responses.getMyResponse),
  ];
  if (keys !== undefined) {
    const anonymous = formsPublicHandlers(formsPublicDependencies(database, platform, keys, log));
    responseRoutes.push(
      route(consoleResponseRoutes.findResponseByReference, responses.findResponseByReference),
      route(publicFormRoutes.getPublicForm, anonymous.getPublicForm),
      route(publicFormRoutes.getProofChallenge, anonymous.getProofChallenge),
      route(publicFormRoutes.submitPublicResponse, anonymous.submitPublicResponse),
    );
  }

  return {
    resolvers: formsResolvers({ store: formsResponseStore }),
    erasure: [formsErasure],
    routes: [
      route(listForms, staff.listForms),
      route(createForm, staff.createForm, { replay: readForm }),
      route(getForm, staff.getForm),
      route(updateFormSettings, staff.updateFormSettings),
      route(updateFormRetention, staff.updateFormRetention),
      route(getFormDraft, staff.getFormDraft),
      route(saveFormDraft, staff.saveFormDraft, { bodyLimit: DRAFT_BODY_LIMIT_BYTES }),
      route(previewFormDraft, staff.previewFormDraft),
      route(listFormVersions, staff.listFormVersions),
      route(getFormVersion, staff.getFormVersion),
      route(publishForm, staff.publishForm, {
        replay: ({ tx, context, input, id }) =>
          staff.getFormVersion({
            tx,
            context,
            input: {
              params: { formId: input.params.formId, formVersionId: platform.created(id) },
            },
          }),
      }),
      route(listFeedbackTemplates, staff.listFeedbackTemplates),
      route(getFeedbackTemplate, staff.getFeedbackTemplate),
      route(createFormFromTemplate, staff.createFormFromTemplate, { replay: readForm }),
      ...responseRoutes,
    ],
  };
};
