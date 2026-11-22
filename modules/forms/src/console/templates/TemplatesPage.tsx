// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Link, PageHeader, Panel, useLoad, WhenLoaded } from '@pixel-scientists/ui';

import { listFeedbackTemplates } from '../../contracts/index.ts';
import { FormsPage } from '../Page.tsx';
import { FORMS_PATH, templatePath } from '../paths.ts';

const load = () => call(listFeedbackTemplates, {});

/** The built-in feedback templates. They cannot be changed here: each starts a form of your own. */
export default function TemplatesPage() {
  const { state, retry } = useLoad(load);
  return (
    <FormsPage>
      <PageHeader
        breadcrumbs={[{ label: 'Forms', to: FORMS_PATH }, { label: 'Templates' }]}
        title="Start from a template"
        description="Each template is a short form for feedback from the people you support. Preview one, then use it to make a form you can change."
      />
      <WhenLoaded state={state} label="Loading templates" retry={retry}>
        {({ templates }) => (
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <li key={template.id}>
                <Panel>
                  <div className="flex h-full flex-col gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-ink">
                      {template.title}
                    </h2>
                    <p className="text-body text-muted">{template.description}</p>
                    <p className="text-body text-muted">{`${String(template.questions)} questions`}</p>
                    <Link to={templatePath(template.id)}>
                      Preview template<span className="sr-only">{`: ${template.title}`}</span>
                    </Link>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </WhenLoaded>
    </FormsPage>
  );
}
