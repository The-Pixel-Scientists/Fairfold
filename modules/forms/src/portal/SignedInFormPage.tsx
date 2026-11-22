// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A form for people who sign in. The draft is saved on the server as the
// person answers, and the person is the session's, never named in a request.

import type { Answers } from '@pixel-scientists/domain/forms';
import { LoadingState, NotFoundPage, useParams } from '@pixel-scientists/ui';
import { useCallback, useRef } from 'react';

import {
  getMyFormDraft,
  getPortalForm,
  saveMyFormDraft,
  submitMyResponse,
} from '../contracts/index.ts';
import { FormRunner } from './FormRunner.tsx';
import { asBody } from './helpers.ts';
import { useFormsHost } from './host.tsx';
import { LoadFailed } from './LoadFailed.tsx';
import { retryKeyOf } from './problems.ts';
import { keepKnown } from './progress.ts';
import { useAutosave } from './useAutosave.tsx';
import { useLoad } from './useLoad.ts';

type Portal = Awaited<ReturnType<typeof readForm>>;

/** The form and the person's draft, read together. */
function readForm(call: ReturnType<typeof useFormsHost>['call'], formId: string) {
  return Promise.all([
    call(getPortalForm, { params: { formId } }),
    call(getMyFormDraft, { params: { formId } }),
  ]);
}

function SignedInForm({ formId, form, draft, reload }: SignedInFormProps) {
  const { call, useDraft } = useFormsHost();
  const key = useRef<string>(undefined);
  const { formVersionId, definition } = form;
  // A draft started on an earlier version keeps the answers the form still asks.
  const saved = keepKnown(definition, draft.answers).kept;
  const kept = useDraft<Answers>(`form:${formId}`, saved);
  const store = useAutosave({
    definition,
    kept,
    saved: { answers: saved, at: draft.updatedAt === null ? null : new Date(draft.updatedAt) },
    save: async (answers) => {
      await call(saveMyFormDraft, {
        params: { formId },
        body: { formVersionId, answers: asBody(answers) },
      });
    },
  });

  return (
    <FormRunner
      title={form.title}
      description={form.description}
      definition={definition}
      store={store}
      submit={async (answers) => {
        try {
          const receipt = await call(
            submitMyResponse,
            { params: { formId }, body: { formVersionId, answers: asBody(answers) } },
            key.current === undefined ? {} : { idempotencyKey: key.current },
          );
          key.current = undefined;
          kept.discard();
          return { message: receipt.confirmationMessage };
        } catch (error) {
          key.current = retryKeyOf(error);
          throw error;
        }
      }}
      onFormChanged={reload}
    />
  );
}

interface SignedInFormProps {
  formId: string;
  form: Portal[0];
  draft: Portal[1];
  reload: () => void;
}

export default function SignedInFormPage() {
  const { formId = '' } = useParams();
  const { call } = useFormsHost();
  const read = useCallback(() => readForm(call, formId), [call, formId]);
  const { load, retry } = useLoad(read, formId);

  if (load.status === 'loading') return <LoadingState label="Loading the form" />;
  if (load.status === 'failed') return <LoadFailed retry={retry} />;
  if (load.status === 'missing') return <NotFoundPage />;
  const [form, draft] = load.data;
  return (
    <SignedInForm
      key={form.formVersionId}
      formId={formId}
      form={form}
      draft={draft}
      reload={retry}
    />
  );
}
