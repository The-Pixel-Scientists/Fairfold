// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DataTable,
  FileDrop,
  SectionProgress,
  SummaryList,
  Tabs,
  Tag,
  TaskList,
} from '@pixel-scientists/ui';
import type { Column, FileDropItem, FileDropProps, SortState, TagTone } from '@pixel-scientists/ui';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

interface Submission {
  reference: string;
  organisation: string;
  amount: number;
  submitted: string;
  status: string;
  tone: TagTone;
  score: number | null;
}

const submissions: readonly Submission[] = [
  {
    reference: 'CG27-0101',
    organisation: 'Brightwater Community Trust',
    amount: 12500,
    submitted: '3 March 2027',
    status: 'In review',
    tone: 'info',
    score: 78,
  },
  {
    reference: 'CG27-0102',
    organisation: 'Harbourside Youth Project',
    amount: 24000,
    submitted: '3 March 2027',
    status: 'Shortlisted',
    tone: 'info',
    score: 86,
  },
  {
    reference: 'CG27-0103',
    organisation: 'Northgate Food Bank',
    amount: 8200,
    submitted: '4 March 2027',
    status: 'In review',
    tone: 'info',
    score: 71,
  },
  {
    reference: 'CG27-0104',
    organisation: "Fenland Women's Refuge",
    amount: 30000,
    submitted: '5 March 2027',
    status: 'Submitted',
    tone: 'info',
    score: null,
  },
  {
    reference: 'CG27-0105',
    organisation: 'Oakmere Allotments Society',
    amount: 4750,
    submitted: '5 March 2027',
    status: 'Ineligible',
    tone: 'danger',
    score: null,
  },
  {
    reference: 'CG27-0106',
    organisation: 'Tamar Valley Arts Collective',
    amount: 15000,
    submitted: '8 March 2027',
    status: 'Shortlisted',
    tone: 'info',
    score: 82,
  },
  {
    reference: 'CG27-0107',
    organisation: 'Stonebridge Reading Circle',
    amount: 6300,
    submitted: '9 March 2027',
    status: 'Withdrawn',
    tone: 'neutral',
    score: null,
  },
  {
    reference: 'CG27-0108',
    organisation: 'Lindenhurst Carers Network',
    amount: 19800,
    submitted: '10 March 2027',
    status: 'In review',
    tone: 'info',
    score: 64,
  },
];

const pounds = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const columns: readonly Column<Submission>[] = [
  {
    key: 'reference',
    header: 'Reference',
    cell: (row) => <span className="text-muted">{row.reference}</span>,
  },
  { key: 'organisation', header: 'Organisation', rowHeader: true, cell: (row) => row.organisation },
  {
    key: 'amount',
    header: 'Amount requested',
    align: 'end',
    sortable: true,
    cell: (row) => pounds.format(row.amount),
  },
  { key: 'submitted', header: 'Submitted', cell: (row) => row.submitted },
  { key: 'status', header: 'Status', cell: (row) => <Tag tone={row.tone}>{row.status}</Tag> },
  {
    key: 'score',
    header: 'Score',
    align: 'end',
    sortable: true,
    cell: (row) => row.score ?? <span className="text-muted">Not scored</span>,
  },
];

/** Sorts by the column's value, with unscored rows last whichever way it runs. */
function sorted(rows: readonly Submission[], { key, direction }: SortState): Submission[] {
  const value = (row: Submission) => (key === 'amount' ? row.amount : row.score);
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
}

function SubmissionsExample() {
  const [sort, setSort] = useState<SortState>({ key: 'score', direction: 'descending' });
  const rows = useMemo(() => sorted(submissions, sort), [sort]);

  return (
    <DataTable
      caption="Community Grants 2027, Spring round"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.reference}
      sort={sort}
      onSortChange={setSort}
    />
  );
}

function TabsExample() {
  return (
    <div className="max-w-2xl">
      <Tabs
        label="Application sections"
        tabs={[
          {
            id: 'answers',
            label: 'Answers',
            content: (
              <SummaryList
                items={[
                  { term: 'Project', value: 'Weekly cooking club for older residents' },
                  { term: 'Amount requested', value: '£12,500' },
                  { term: 'People helped', value: '40 residents a week, for 12 months' },
                  { term: 'Start date', value: '1 June 2027' },
                ]}
              />
            ),
          },
          {
            id: 'reviews',
            label: 'Reviews',
            content: (
              <p className="max-w-prose text-body">
                Two of three reviews are submitted, with scores of 76 and 80. The third reviewer has
                not started.
              </p>
            ),
          },
          {
            id: 'notes',
            label: 'Notes',
            content: (
              <p className="max-w-prose text-body text-muted">
                No notes yet. Add a note to share context with other staff.
              </p>
            ),
          },
          {
            id: 'history',
            label: 'History',
            content: (
              <ol role="list" className="flex flex-col gap-2 text-body">
                <li>
                  <span className="font-medium">10 March 2027:</span> Review submitted by Priya Shah
                </li>
                <li>
                  <span className="font-medium">5 March 2027:</span> Moved to In review
                </li>
                <li>
                  <span className="font-medium">3 March 2027:</span> Application submitted
                </li>
              </ol>
            ),
          },
        ]}
      />
    </div>
  );
}

function TaskListExample() {
  return (
    <div className="max-w-xl">
      <TaskList
        label="Application sections"
        items={[
          {
            label: 'About your organisation',
            to: '/dev/components?section=organisation',
            status: 'completed',
          },
          {
            label: 'Your project',
            to: '/dev/components?section=project',
            status: 'in-progress',
            hint: 'Describe who will benefit and what will change.',
          },
          { label: 'Budget', to: '/dev/components?section=budget', status: 'not-started' },
          { label: 'Outcomes', to: '/dev/components?section=outcomes', status: 'not-started' },
          {
            label: 'Documents',
            status: 'cannot-start',
            hint: 'Complete Budget first, so we know which documents to ask for.',
          },
          {
            label: 'Declarations',
            status: 'cannot-start',
            hint: 'Complete every other section first.',
          },
        ]}
      />
    </div>
  );
}

const uploads: readonly FileDropItem[] = [
  { id: 'accounts', name: 'Accounts 2025-26.pdf', size: 1_258_291, status: 'ready' },
  { id: 'constitution', name: 'Constitution.pdf', size: 856_064, status: 'scanning' },
  {
    id: 'safeguarding',
    name: 'Safeguarding policy.docx',
    size: 3_355_443,
    status: 'uploading',
    progress: 40,
  },
];

const declaration: readonly FileDropItem[] = [
  { id: 'declaration', name: 'Signed declaration.pdf', size: 214_016, status: 'ready' },
];

function FileDropExample({
  initial,
  ...props
}: Pick<FileDropProps, 'label' | 'hint' | 'multiple'> & { initial: readonly FileDropItem[] }) {
  const [files, setFiles] = useState(initial);

  return (
    <FileDrop
      {...props}
      accept=".pdf,.doc,.docx"
      files={files}
      onFilesChosen={(chosen) => {
        const added = chosen.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          status: 'scanning' as const,
        }));
        setFiles((current) => (props.multiple ? [...current, ...added] : added));
      }}
      onRemove={(id) => {
        setFiles((current) => current.filter((file) => file.id !== id));
      }}
    />
  );
}

/** Gallery entries for the data and progress components. */
export function DataExamples() {
  return (
    <>
      <Section title="Data table">
        <SubmissionsExample />
        <DataTable
          caption="Applications in the Autumn round"
          columns={columns}
          rows={[]}
          rowKey={(row) => row.reference}
          empty={
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink">No applications yet</p>
              <p className="text-muted">
                Share the programme link to start receiving applications.
              </p>
            </div>
          }
        />
      </Section>

      <Section title="Tabs">
        <TabsExample />
      </Section>

      <Section title="Task list">
        <TaskListExample />
      </Section>

      <Section title="Section progress">
        <div className="max-w-xl">
          <SectionProgress current={3} total={6} title="Budget" />
        </div>
      </Section>

      <Section title="File upload">
        <div className="flex max-w-xl flex-col gap-6">
          <FileDropExample
            label="Supporting documents"
            hint="PDF or Word files, up to 10 MB each."
            multiple
            initial={uploads}
          />
          <FileDropExample
            label="Signed declaration"
            hint="One PDF or Word file, up to 10 MB."
            initial={declaration}
          />
        </div>
      </Section>
    </>
  );
}
