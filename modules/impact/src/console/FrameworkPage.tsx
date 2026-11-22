// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, Notice, PageHeader, Tag, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';

import { archiveFramework } from '../contracts/index.ts';
import { loadFrameworkPage, loadSummary } from './loaders.ts';
import type { FrameworkPageData } from './loaders.ts';
import { NotesSection } from './NotesSection.tsx';
import { Gate, LinkButton, RemoveDialog, useCanChange, useParam } from './Page.tsx';
import { editFrameworkPath, IMPACT_PATH } from './paths.ts';
import { ProgressSection } from './Progress.tsx';
import { ResultsSection } from './ResultsSection.tsx';
import { TargetsSection } from './TargetsSection.tsx';

function FrameworkView({ initial }: { initial: FrameworkPageData }) {
  const [data, setData] = useState(initial);
  const [archiving, setArchiving] = useState(false);
  const { framework } = data;
  const archived = framework.archivedAt !== null;
  const canSetUp = useCanChange('impact.frameworks.manage', archived);
  const canRecord = useCanChange('impact.results.manage', archived);

  const reload = async () => {
    setData(await loadFrameworkPage(framework.id));
  };
  const reloadSummary = async () => {
    const summary = await loadSummary(framework.id);
    setData((before) => ({ ...before, summary }));
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Impact', to: IMPACT_PATH }, { label: framework.name }]}
        title={framework.name}
        description={framework.description === '' ? undefined : framework.description}
        eyebrow={archived ? <Tag tone="neutral">Archived</Tag> : undefined}
        actions={
          canSetUp && (
            <>
              <LinkButton to={editFrameworkPath(framework.id)}>Edit framework</LinkButton>
              <Button
                onClick={() => {
                  setArchiving(true);
                }}
              >
                Archive framework
              </Button>
            </>
          )
        }
      />
      {archived && (
        <Notice tone="warning" title="This framework is archived">
          It takes no changes, targets or results. Make a new framework to start again.
        </Notice>
      )}
      <ProgressSection framework={framework} summary={data.summary} />
      <TargetsSection
        framework={framework}
        targets={data.targets}
        canChange={canSetUp}
        reload={reload}
      />
      <ResultsSection framework={framework} canChange={canRecord} changed={reloadSummary} />
      <NotesSection
        framework={framework}
        notes={data.notes}
        canChange={canRecord}
        reload={reload}
      />
      {archiving && (
        <RemoveDialog
          title="Archive this framework?"
          description="An archived framework keeps its targets, results and notes, but takes no changes and no new results. You cannot undo this."
          submit="Archive framework"
          onClose={() => {
            setArchiving(false);
          }}
          action={async () => {
            await call(archiveFramework, { params: { frameworkId: framework.id } });
            setArchiving(false);
            await reload();
          }}
        />
      )}
    </>
  );
}

function LoadedFramework({ frameworkId }: { frameworkId: string }) {
  const { state, retry } = useLoad(loadFrameworkPage, frameworkId);
  return (
    <WhenLoaded state={state} label="Loading the framework" retry={retry}>
      {(loaded) => <FrameworkView initial={loaded} />}
    </WhenLoaded>
  );
}

/** One framework: its progress, targets, results and learning notes. */
export default function FrameworkPage() {
  return (
    <Gate permission="impact.frameworks.read" title="Outcomes framework">
      <LoadedFramework frameworkId={useParam('frameworkId')} />
    </Gate>
  );
}
