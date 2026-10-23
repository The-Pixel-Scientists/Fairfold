// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, Tabs, Tag, useLoad, useSearch, WhenLoaded } from '@pixel-scientists/ui';

import { submissionQuerySchema } from '../../contracts/index.ts';
import type { Submission, SubmissionQuery } from '../../contracts/index.ts';
import { formatMoment } from '../programme/format.ts';
import { useParam } from '../programme/Page.tsx';
import { Aside } from './detail/Aside.tsx';
import { ApplicationTab } from './detail/ApplicationTab.tsx';
import { EligibilityTab } from './detail/EligibilityTab.tsx';
import { HistoryTab } from './detail/HistoryTab.tsx';
import { Neighbours } from './detail/Neighbours.tsx';
import { StagePath } from './detail/StagePath.tsx';
import { loadSubmission } from './loaders.ts';
import { submissionsPath } from './paths.ts';
import { searchOf } from './query.ts';
import { ReadPage } from './ReadPage.tsx';
import { EligibilityTag, StatusTag } from './words.tsx';

const NO_QUERY: SubmissionQuery = {};

function About({ submission }: { submission: Submission }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Tag tone="info">{submission.stage.name}</Tag>
      <StatusTag status={submission.status} />
      {submission.late && <Tag tone="warning">Late</Tag>}
      <EligibilityTag outcome={submission.eligibility} />
      <span>
        {submission.programme.title}, {submission.round.title}
      </span>
      {submission.withdrawnAt !== null && (
        <span>Withdrawn on {formatMoment(submission.withdrawnAt)}</span>
      )}
    </span>
  );
}

function Detail({ submissionId }: { submissionId: string }) {
  const search = useSearch(submissionQuerySchema);
  const query = search.success ? search.data : NO_QUERY;
  const { state, retry } = useLoad(loadSubmission, submissionId);
  const loaded = state.status === 'ready' ? state.value : null;
  const name = loaded?.submission.organisation.name ?? 'Submission';

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Submissions', to: submissionsPath(searchOf(query)) },
          { label: name },
        ]}
        title={name}
        description={loaded && <About submission={loaded.submission} />}
        actions={<Neighbours query={query} id={submissionId} />}
      >
        {loaded?.stages && <StagePath stages={loaded.stages} submission={loaded.submission} />}
      </PageHeader>
      <WhenLoaded state={state} label="Loading the submission" retry={retry}>
        {({ submission, files }) => (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Tabs
              label="Submission sections"
              tabs={[
                {
                  id: 'application',
                  label: 'Application',
                  content: <ApplicationTab submission={submission} files={files} />,
                },
                {
                  id: 'eligibility',
                  label: 'Eligibility',
                  content: <EligibilityTab submission={submission} />,
                },
                {
                  id: 'history',
                  label: 'History',
                  content: <HistoryTab history={submission.history} />,
                },
              ]}
            />
            <Aside submission={submission} />
          </div>
        )}
      </WhenLoaded>
    </>
  );
}

/** One submission: its answers, eligibility and history, the organisation and contact, and a way to the next one in the list. */
export default function SubmissionPage() {
  const submissionId = useParam('submissionId');
  return (
    <ReadPage title="Submission">
      <Detail key={submissionId} submissionId={submissionId} />
    </ReadPage>
  );
}
