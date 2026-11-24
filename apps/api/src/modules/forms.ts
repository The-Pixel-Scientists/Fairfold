// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's composition (ADR 0016): its routes, scope rules, jobs and
// contributions, built from the platform's dependencies. The staff routes for
// forms, drafts, versions and templates are here; their SQL is in
// forms-store.ts, which the module's handlers read and write through.

import {
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
  previewFormDraft,
  publishForm,
  saveFormDraft,
  updateFormRetention,
  updateFormSettings,
} from '@pixel-scientists/forms/contracts';
import { formsStaffHandlers } from '@pixel-scientists/forms/server';

import type { MemberContext } from '../context.ts';
import type { TenantTransaction } from '../database.ts';
import { route } from '../routes/register.ts';
import { formsStore } from './forms-store.ts';
import type { ModuleFactory } from './types.ts';

/** Room for a definition at its limit, written with spaces, in a request; the contract's schema checks the size itself. */
const DRAFT_BODY_LIMIT_BYTES = 2 * FORM_DEFINITION_MAX_BYTES;

export const formsComposition: ModuleFactory = ({ platform }) => {
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

  return {
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
    ],
  };
};
