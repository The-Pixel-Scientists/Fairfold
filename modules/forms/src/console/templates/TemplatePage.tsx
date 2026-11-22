// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { NotFoundPage, PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { Preview } from '@pixel-scientists/ui/form-builder';

import { createFormFromTemplate, getFeedbackTemplate } from '../../contracts/index.ts';
import { CreateForm } from '../list/CreateForm.tsx';
import { FormsPage, orMissing, useParam } from '../Page.tsx';
import { FORMS_PATH, TEMPLATES_PATH } from '../paths.ts';

const load = (templateId: string) =>
  orMissing(call(getFeedbackTemplate, { params: { templateId } }));

function Template({ templateId }: { templateId: string }) {
  const { state, retry } = useLoad(load, templateId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Template" />}
      <WhenLoaded state={state} label="Loading the template" retry={retry}>
        {(template) =>
          template === null ? (
            <NotFoundPage />
          ) : (
            <>
              <PageHeader
                breadcrumbs={[
                  { label: 'Forms', to: FORMS_PATH },
                  { label: 'Templates', to: TEMPLATES_PATH },
                  { label: template.title },
                ]}
                title={template.title}
                description={template.description}
              />
              <section aria-labelledby="use-heading" className="flex flex-col gap-3">
                <h2 id="use-heading" className="text-lg font-semibold tracking-tight text-ink">
                  Make a form from this template
                </h2>
                <CreateForm
                  initialTitle={template.title}
                  submit="Use this template"
                  create={(body, idempotencyKey) =>
                    call(
                      createFormFromTemplate,
                      { params: { templateId }, body },
                      idempotencyKey === undefined ? {} : { idempotencyKey },
                    )
                  }
                />
              </section>
              <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
                <h2 id="preview-heading" className="text-lg font-semibold tracking-tight text-ink">
                  Preview template
                </h2>
                <p className="text-body text-muted">
                  Preview only. Answers are not saved. You change the questions in your own form,
                  not in the template.
                </p>
                <Preview definition={template.definition} />
              </section>
            </>
          )
        }
      </WhenLoaded>
    </>
  );
}

export default function TemplatePage() {
  return (
    <FormsPage>
      <Template templateId={useParam('templateId')} />
    </FormsPage>
  );
}
