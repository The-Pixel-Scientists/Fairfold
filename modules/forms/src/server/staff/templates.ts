// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The feedback template routes' handlers. The templates are built into the
// contracts and never change under a form made from one: a new form gets a
// copy of the latest version as its first draft, with its configuration
// version and audit event written as for any new form.

import { questionsOf } from '@pixel-scientists/domain/forms';

import {
  feedbackTemplates,
  type FeedbackTemplateDetail,
  type FormSettingsInput,
} from '../../contracts/index.ts';
import type { Args, StaffDependencies } from './context.ts';
import { formCore } from './forms.ts';

export interface TemplateParams {
  readonly params: { readonly templateId: string };
}

export function templateHandlers<Tx>(deps: StaffDependencies<Tx>) {
  const { makeForm } = formCore(deps);

  function lookup(templateId: string): Promise<FeedbackTemplateDetail> {
    const found = feedbackTemplates.find(({ id }) => id === templateId);
    return found === undefined ? Promise.reject(deps.notFound()) : Promise.resolve(found);
  }

  function listFeedbackTemplates() {
    return Promise.resolve({
      templates: feedbackTemplates.map(({ id, version, title, description, definition }) => ({
        id,
        version,
        title,
        description,
        questions: questionsOf(definition).length,
      })),
    });
  }

  const getFeedbackTemplate = ({ input }: Args<Tx, TemplateParams>) =>
    lookup(input.params.templateId);

  const createFormFromTemplate = async ({
    tx,
    context,
    input,
  }: Args<Tx, TemplateParams & { body: FormSettingsInput }>) =>
    makeForm({ tx, context }, input.body, (await lookup(input.params.templateId)).definition);

  return { listFeedbackTemplates, getFeedbackTemplate, createFormFromTemplate };
}
