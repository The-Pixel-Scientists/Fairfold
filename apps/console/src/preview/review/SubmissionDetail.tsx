// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: one submission as staff see it, with the registry checks
// on their own tab, which reviewers never see.

import { Button, PageHeader, Tabs, Tag, useLocation } from '@pixel-scientists/ui';
import { useState } from 'react';

import { Aside } from './detail/Aside.tsx';
import { ApplicationTab } from './detail/ApplicationTab.tsx';
import { DiligenceTab } from './detail/DiligenceTab.tsx';
import { EligibilityTab } from './detail/EligibilityTab.tsx';
import { HistoryTab } from './detail/HistoryTab.tsx';
import { NotesTab } from './detail/NotesTab.tsx';
import { ReviewsTab } from './detail/ReviewsTab.tsx';
import { notes as startingNotes, reference } from './featured.ts';
import type { Note } from './featured.ts';
import { LockIcon } from './icons.tsx';
import { StagePath } from './StagePath.tsx';

export default function SubmissionDetail() {
  const [notes, setNotes] = useState<readonly Note[]>(startingNotes);
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: 'Submissions', to: '/submissions' }, { label: reference }]}
        eyebrow={
          <>
            <Tag tone="info">Design preview</Tag>
            <span>Community Grants, Spring 2027</span>
          </>
        }
        title="Riverside Lunch Club"
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Tag tone="info">Shortlisted</Tag>
            <span>Northfield Community Trust</span>
            <span className="tabular-nums">{reference}</span>
          </span>
        }
        actions={
          <>
            <Button>Message applicant</Button>
            <Button variant="primary">Move to decision</Button>
          </>
        }
      >
        <StagePath />
      </PageHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Tabs
          label="Submission sections"
          defaultTab={pathname.endsWith('/due-diligence') ? 'diligence' : 'application'}
          tabs={[
            { id: 'application', label: 'Application', content: <ApplicationTab /> },
            { id: 'eligibility', label: 'Eligibility', content: <EligibilityTab /> },
            {
              id: 'diligence',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Due diligence
                  <LockIcon className="size-3.5" />
                  <span className="sr-only">(staff only)</span>
                </span>
              ),
              content: <DiligenceTab />,
            },
            { id: 'reviews', label: 'Reviews', content: <ReviewsTab /> },
            {
              id: 'notes',
              label: `Notes (${String(notes.length)})`,
              content: <NotesTab notes={notes} />,
            },
            { id: 'history', label: 'History', content: <HistoryTab /> },
          ]}
        />
        <Aside
          notes={notes}
          onAddNote={(text) => {
            setNotes([{ author: 'Ada Morgan', when: '17 March 2027, 2:31pm', text }, ...notes]);
          }}
        />
      </div>
    </div>
  );
}
