// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';

import { FrameworkForm } from './FrameworkForm.tsx';
import { loadFramework } from './loaders.ts';
import { Gate, useParam } from './Page.tsx';
import { frameworkPath, IMPACT_PATH } from './paths.ts';

function EditFramework({ frameworkId }: { frameworkId: string }) {
  const { state, retry } = useLoad(loadFramework, frameworkId);
  const framework = state.status === 'ready' ? state.value : null;
  return (
    <>
      <PageHeader
        breadcrumbs={
          framework
            ? [
                { label: 'Impact', to: IMPACT_PATH },
                { label: framework.name, to: frameworkPath(framework.id) },
                { label: 'Edit' },
              ]
            : undefined
        }
        title="Edit framework"
      />
      <WhenLoaded state={state} label="Loading the framework" retry={retry}>
        {(loaded) => <FrameworkForm framework={loaded} />}
      </WhenLoaded>
    </>
  );
}

export default function EditFrameworkPage() {
  return (
    <Gate permission="impact.frameworks.manage" title="Edit framework">
      <EditFramework frameworkId={useParam('frameworkId')} />
    </Gate>
  );
}
