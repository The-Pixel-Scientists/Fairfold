// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { modules } from '@pixel-scientists/domain/platform';
import { Button, DataTable, EmptyState, PageHeader, Panel } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  getProcessingRecord,
  listProcessingActivities,
  listProcessors,
} from '../../contracts/index.ts';
import type { ProcessingActivity, Processor } from '../../contracts/index.ts';
import { usePages, useRead, useZone } from '../hooks.ts';
import { Reading } from '../parts.tsx';
import {
  basisWords,
  categoryWords,
  formatDate,
  safeguardWords,
  todayIn,
  subjectWords,
  conditionWords,
} from '../words.ts';
import { ActivityDialog } from './ActivityDialog.tsx';
import { ProcessorDialog } from './ProcessorDialog.tsx';

const loadRecord = () => call(getProcessingRecord, {});

const loadActivities = (cursor: string | undefined) =>
  call(listProcessingActivities, { query: cursor === undefined ? {} : { cursor } }).then(
    ({ activities, nextCursor }) => ({ items: activities, next: nextCursor }),
  );

const loadProcessors = (cursor: string | undefined) =>
  call(listProcessors, { query: cursor === undefined ? {} : { cursor } }).then(
    ({ processors, nextCursor }) => ({ items: processors, next: nextCursor }),
  );

const retentionText = ({ rule, days }: { rule: string; days: number | null }) =>
  `${rule.replaceAll('_', ' ')}, ${days === null ? 'no fixed period' : `${String(days)} days`}`;

const words = (values: readonly string[], list: Readonly<Record<string, string>>) =>
  values.map((value) => list[value] ?? value).join(', ');

export function ProcessingPage() {
  const zone = useZone();
  const record = useRead(loadRecord);
  const activities = usePages(loadActivities, '');
  const processors = usePages(loadProcessors, '');
  const [activity, setActivity] = useState<ProcessingActivity | 'new' | null>(null);
  const [processor, setProcessor] = useState<Processor | 'new' | null>(null);
  const [saved, setSaved] = useState('');

  const processorList = processors.state.status === 'ready' ? processors.state.value.items : [];
  const processorName = (id: string) =>
    processorList.find((found) => found.id === id)?.name ?? 'A processor';

  const savedAs = (message: string) => {
    setSaved(message);
    record.reload();
  };

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Records of processing"
        description="What personal data you hold, why, on what lawful basis, for how long, and who processes it. The record below is generated from how every field is classified. Add the activities and processors it cannot know."
      />
      <p role="status" className="font-medium text-success empty:hidden">
        {saved}
      </p>
      <Panel title="Generated record">
        <Reading state={record.state} label="Loading the record" retry={record.reload} inline>
          {({ generatedAt, tables }) => (
            <div className="flex flex-col gap-2">
              <p className="text-body text-muted">
                Read only. Generated on {formatDate(todayIn(generatedAt, zone))}.
              </p>
              <DataTable
                caption="Record of processing, one row for each table"
                captionHidden
                rows={tables}
                rowKey={(row) => row.table}
                columns={[
                  { key: 'table', header: 'Table', rowHeader: true, cell: (row) => row.table },
                  { key: 'tool', header: 'Tool', cell: (row) => modules[row.module].label },
                  {
                    key: 'category',
                    header: 'Kinds of data',
                    cell: (row) => words(row.dataCategories, categoryWords) || 'Not set',
                  },
                  {
                    key: 'sensitivity',
                    header: 'Sensitivity',
                    cell: (row) => row.sensitivity.replaceAll('_', ' '),
                  },
                  {
                    key: 'retention',
                    header: 'Retention',
                    cell: (row) => retentionText(row.retention),
                  },
                  {
                    key: 'subject',
                    header: 'Reaches a person through',
                    cell: (row) => row.subjectPaths.join(', ') || 'Not about a person',
                  },
                  { key: 'purpose', header: 'Purpose', cell: (row) => row.purpose || 'Not set' },
                  {
                    key: 'basis',
                    header: 'Lawful basis',
                    cell: (row) =>
                      row.legalBasis === null ? 'Not set' : basisWords[row.legalBasis],
                  },
                  {
                    key: 'processors',
                    header: 'Processors',
                    cell: (row) => row.processorIds.map(processorName).join(', ') || 'None',
                  },
                ]}
              />
            </div>
          )}
        </Reading>
      </Panel>
      <Panel
        title="Processing activities"
        actions={
          <Button
            onClick={() => {
              setActivity('new');
            }}
          >
            Add activity
          </Button>
        }
      >
        <Reading
          state={activities.state}
          label="Loading activities"
          retry={activities.reload}
          inline
        >
          {({ items, next }) => (
            <>
              <DataTable
                caption="Processing activities, one row for each activity"
                captionHidden
                rows={items}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'name',
                    header: 'Activity',
                    rowHeader: true,
                    cell: (row) => <span className="whitespace-normal">{row.name}</span>,
                  },
                  {
                    key: 'basis',
                    header: 'Lawful basis',
                    cell: (row) => basisWords[row.legalBasis],
                  },
                  {
                    key: 'condition',
                    header: 'Special category condition',
                    cell: (row) =>
                      row.specialCategoryCondition === null
                        ? 'None'
                        : conditionWords[row.specialCategoryCondition],
                  },
                  {
                    key: 'people',
                    header: 'Whose data',
                    cell: (row) => words(row.subjectCategories, subjectWords) || 'Not set',
                  },
                  {
                    key: 'updated',
                    header: 'Changed',
                    cell: (row) => formatDate(todayIn(row.updatedAt, zone)),
                  },
                  {
                    key: 'edit',
                    header: 'Actions',
                    cell: (row) => (
                      <Button
                        aria-label={`Edit ${row.name}`}
                        onClick={() => {
                          setActivity(row);
                        }}
                      >
                        Edit
                      </Button>
                    ),
                  },
                ]}
                empty={
                  <EmptyState
                    title="No activities yet"
                    action={
                      <Button
                        variant="primary"
                        onClick={() => {
                          setActivity('new');
                        }}
                      >
                        Add activity
                      </Button>
                    }
                  >
                    <p>
                      Add each thing you do with personal data that the generated record cannot
                      show, such as running a mailing list.
                    </p>
                  </EmptyState>
                }
              />
              {next !== null && (
                <div>
                  <Button onClick={activities.more}>Show more activities</Button>
                </div>
              )}
            </>
          )}
        </Reading>
      </Panel>
      <Panel
        title="Processors"
        actions={
          <Button
            onClick={() => {
              setProcessor('new');
            }}
          >
            Add processor
          </Button>
        }
      >
        <Reading
          state={processors.state}
          label="Loading processors"
          retry={processors.reload}
          inline
        >
          {({ items, next }) => (
            <>
              <DataTable
                caption="Processors, one row for each processor"
                captionHidden
                rows={items}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'name', header: 'Processor', rowHeader: true, cell: (row) => row.name },
                  {
                    key: 'service',
                    header: 'What they do',
                    cell: (row) => <span className="whitespace-normal">{row.service}</span>,
                  },
                  { key: 'country', header: 'Country', cell: (row) => row.countryCode },
                  {
                    key: 'contract',
                    header: 'Contract signed',
                    cell: (row) =>
                      row.contractSignedOn === null
                        ? 'Not recorded'
                        : formatDate(row.contractSignedOn),
                  },
                  {
                    key: 'safeguard',
                    header: 'Transfer safeguard',
                    cell: (row) =>
                      row.transferSafeguard === null
                        ? 'None'
                        : safeguardWords[row.transferSafeguard],
                  },
                  {
                    key: 'edit',
                    header: 'Actions',
                    cell: (row) => (
                      <Button
                        aria-label={`Edit ${row.name}`}
                        onClick={() => {
                          setProcessor(row);
                        }}
                      >
                        Edit
                      </Button>
                    ),
                  },
                ]}
                empty={
                  <EmptyState
                    title="No processors yet"
                    action={
                      <Button
                        variant="primary"
                        onClick={() => {
                          setProcessor('new');
                        }}
                      >
                        Add processor
                      </Button>
                    }
                  >
                    <p>
                      Add each company or service that handles personal data for you, such as your
                      email provider.
                    </p>
                  </EmptyState>
                }
              />
              {next !== null && (
                <div>
                  <Button onClick={processors.more}>Show more processors</Button>
                </div>
              )}
            </>
          )}
        </Reading>
      </Panel>
      <ActivityDialog
        target={activity}
        processors={processorList}
        onClose={() => {
          setActivity(null);
        }}
        onSaved={() => {
          savedAs('Activity saved. The record of processing has a new version.');
          activities.reload();
        }}
      />
      <ProcessorDialog
        target={processor}
        onClose={() => {
          setProcessor(null);
        }}
        onSaved={() => {
          savedAs('Processor saved. The record of processing has a new version.');
          processors.reload();
        }}
      />
    </div>
  );
}
