// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: a reviewer's inbox. Review is blind, so it lists projects
// by reference and title and never names an organisation.

import {
  DataTable,
  Link,
  Meter,
  PageHeader,
  Stats,
  Tag,
  buttonClassName,
} from '@pixel-scientists/ui';
import type { Column, TagTone } from '@pixel-scientists/ui';
import { useState } from 'react';

import { rows } from './data.ts';
import { FilterTabs } from './FilterTabs.tsx';
import { InfoIcon } from './icons.tsx';
import { assignments, reviewer } from './inbox.ts';
import type { Assignment, ReviewState } from './inbox.ts';
import { Notice } from './Notice.tsx';

type Filter = 'all' | 'todo' | 'submitted';

const tones: Readonly<Record<ReviewState, TagTone>> = {
  'Not started': 'neutral',
  'In progress': 'info',
  Submitted: 'success',
};

const projects = new Map(rows.map((row) => [row.reference, row.project]));
const projectOf = (assignment: Assignment) => projects.get(assignment.reference) ?? '';

const actionOf = (assignment: Assignment) =>
  assignment.state === 'Not started'
    ? 'Start review'
    : assignment.state === 'In progress'
      ? 'Continue'
      : 'View review';

const columns: readonly Column<Assignment>[] = [
  {
    key: 'reference',
    header: 'Reference',
    cell: (assignment) => <span className="text-muted tabular-nums">{assignment.reference}</span>,
  },
  {
    key: 'project',
    header: 'Project',
    rowHeader: true,
    cell: (assignment) => <span className="font-medium">{projectOf(assignment)}</span>,
  },
  { key: 'due', header: 'Due', cell: (assignment) => assignment.due },
  {
    key: 'status',
    header: 'Status',
    cell: (assignment) => (
      <div className="flex flex-col items-start gap-1">
        <Tag tone={tones[assignment.state]}>{assignment.state}</Tag>
        {assignment.submitted && <span className="text-sm text-muted">{assignment.submitted}</span>}
      </div>
    ),
  },
  {
    key: 'action',
    header: 'Action',
    align: 'end',
    cell: (assignment) => (
      <Link
        to={`/reviews/${assignment.reference}`}
        aria-label={`${actionOf(assignment)}: ${projectOf(assignment)}`}
        className={buttonClassName(
          assignment.state === 'Submitted' ? 'quiet' : 'secondary',
          'no-underline',
        )}
      >
        {actionOf(assignment)}
      </Link>
    ),
  },
];

export default function MyReviews() {
  const [filter, setFilter] = useState<Filter>('all');
  const todo = assignments.filter((assignment) => assignment.state !== 'Submitted');
  const shown = {
    all: assignments,
    todo,
    submitted: assignments.filter((assignment) => assignment.state === 'Submitted'),
  }[filter];
  const progress = assignments.length - todo.length;
  const started = todo.filter((assignment) => assignment.state === 'In progress').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <>
            <Tag tone="info">Design preview</Tag>
            <span>Reviewing as {reviewer}</span>
          </>
        }
        title="My reviews"
        description="Applications assigned to you for Community Grants, Spring 2027. Review is blind: you see each project, not who is behind it."
      />

      <Stats
        label="Your reviews"
        items={[
          { label: 'Assigned to you', value: assignments.length, detail: 'Since 5 March 2027' },
          {
            label: 'Submitted',
            value: progress,
            detail: `${String(Math.round((progress / assignments.length) * 100))}% done`,
          },
          {
            label: 'To do',
            value: todo.length,
            detail: `${String(started)} in progress, ${String(todo.length - started)} not started`,
          },
          {
            label: 'Reviews due',
            value: '24 March 2027',
            detail: `For the ${String(todo.length)} still to do`,
          },
        ]}
      />

      <Meter
        label="Your progress"
        value={progress}
        max={assignments.length}
        valueText={`${String(progress)} of ${String(assignments.length)} reviews submitted`}
      />

      <Notice
        tone="info"
        icon={<InfoIcon />}
        title="Know the applicant? Declare a conflict of interest."
      >
        <p>
          Open the project and choose Declare a conflict. It comes off your list and goes to another
          reviewer, and you do not score it. You never need to say who the applicant is.
        </p>
      </Notice>

      <div className="flex flex-col gap-3">
        <FilterTabs<Filter>
          label="Show reviews"
          options={[
            { value: 'all', label: 'All', count: assignments.length },
            { value: 'todo', label: 'To do', count: todo.length },
            { value: 'submitted', label: 'Submitted', count: progress },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <DataTable
          caption="Reviews assigned to you"
          captionHidden
          columns={columns}
          rows={shown}
          rowKey={(assignment) => assignment.reference}
        />
      </div>
    </div>
  );
}
