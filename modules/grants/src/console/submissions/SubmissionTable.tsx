// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Link, Tag } from '@pixel-scientists/ui';
import type { Column, RowSelection } from '@pixel-scientists/ui';

import type { SubmissionSummary } from '../../contracts/index.ts';
import { submissionPath } from './paths.ts';
import { EligibilityTag, formatDay, nextStep, StatusTag } from './words.tsx';

export interface SubmissionTableProps {
  submissions: readonly SubmissionSummary[];
  /** The list's own search string, which a submission's address carries so its page can come back to this list. */
  search: string;
  /** Without it, the rows cannot be chosen. */
  selection?: RowSelection<SubmissionSummary>;
  onOpen: (submission: SubmissionSummary) => void;
  onHelp: () => void;
}

const wrap = 'block min-w-40 max-w-80 whitespace-normal';

function columns(search: string): readonly Column<SubmissionSummary>[] {
  return [
    {
      key: 'organisation',
      header: 'Organisation',
      rowHeader: true,
      cell: (submission) => (
        <span className={`${wrap} flex flex-col`}>
          <Link to={submissionPath(submission.id, search)}>{submission.organisation.name}</Link>
          <span className="text-sm font-normal text-muted">{submission.programme.title}</span>
        </span>
      ),
    },
    { key: 'round', header: 'Round', cell: (submission) => submission.round.title },
    { key: 'stage', header: 'Stage', cell: (submission) => submission.stage.name },
    {
      key: 'submitted',
      header: 'Submitted',
      cell: (submission) => (
        <span className="flex items-center gap-2">
          {formatDay(submission.submittedAt)}
          {submission.late && <Tag tone="warning">Late</Tag>}
        </span>
      ),
    },
    {
      key: 'eligibility',
      header: 'Eligibility',
      cell: (submission) => <EligibilityTag outcome={submission.eligibility} />,
    },
    {
      key: 'status',
      header: 'Status and next step',
      cell: (submission) => (
        <div className="flex flex-col items-start gap-1">
          <StatusTag status={submission.status} />
          <span className="text-sm text-muted">{nextStep(submission)}</span>
        </div>
      ),
    },
  ];
}

/** The submissions as a dense table. Each row opens with Enter and, where allowed, is chosen with Space. */
export function SubmissionTable({
  submissions,
  search,
  selection,
  onOpen,
  onHelp,
}: SubmissionTableProps) {
  return (
    <DataTable
      caption="Submissions"
      captionHidden
      columns={columns(search)}
      rows={submissions}
      rowKey={(submission) => submission.id}
      onOpenRow={onOpen}
      onHelp={onHelp}
      {...(selection && { selection })}
    />
  );
}
