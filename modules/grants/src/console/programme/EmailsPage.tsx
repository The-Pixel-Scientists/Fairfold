// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';

import { EmailTemplateEditor } from './EmailTemplateEditor.tsx';
import { loadEmailPage } from './loaders.ts';
import { ManagePage, useParam } from './Page.tsx';
import { PROGRAMMES_PATH, programmePath } from './paths.ts';

function Emails({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadEmailPage, programmeId);
  const loaded = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: loaded.programme.title, to: programmePath(programmeId) },
                { label: 'Outcome emails' },
              ]
            : undefined
        }
        title="Outcome emails"
        description="Applicants get one of these emails when you release their decision. Nothing is sent when you record a decision."
      />
      <WhenLoaded state={state} label="Loading the emails" retry={retry}>
        {({ templates }) => <EmailTemplateEditor programmeId={programmeId} templates={templates} />}
      </WhenLoaded>
    </>
  );
}

export default function EmailsPage() {
  return (
    <ManagePage title="Outcome emails">
      <Emails programmeId={useParam('programmeId')} />
    </ManagePage>
  );
}
