// SPDX-License-Identifier: AGPL-3.0-or-later

import { PageHeader, Panel, WhenLoaded, useLoad, EmptyState } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { Segment } from '../../contracts/index.ts';
import { useParam } from '../Gate.tsx';
import { PartyLink } from '../labels.tsx';
import { Needs } from '../Needs.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { SEGMENTS_PATH } from '../paths.ts';
import { kindWords } from '../words.ts';
import { loadSegment, loadSegmentMembers } from './api.ts';
import { fieldLabels, operatorLabels, valueChoices } from './words.ts';

type Member = Awaited<ReturnType<typeof loadSegmentMembers>>['items'][number];

const columns: readonly Column<Member>[] = [
  {
    key: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (member) => <PartyLink kind={member.kind} id={member.partyId} />,
  },
  { key: 'kind', header: 'Kind', cell: (member) => kindWords[member.kind] },
];

/** A filter in words, such as "Kind is Organisation". A list or a date reads as what it is. */
function filterWords(filter: Segment['filters'][string]): string {
  const value =
    valueChoices(filter.field)?.find((choice) => choice.value === filter.value)?.label ??
    (filter.field === 'list' ? 'the chosen list' : filter.value);
  return `${fieldLabels[filter.field]} ${operatorLabels[filter.operator]} ${value}`;
}

function Members({ segmentId }: { segmentId: string }) {
  const paged = usePaged(loadSegmentMembers, segmentId);
  return (
    <PagedTable
      paged={paged}
      label="Loading members"
      caption="Members of this segment"
      columns={columns}
      rowKey={(member) => member.partyId}
      empty={
        <EmptyState title="No records match this segment">
          <p>Change the filters in a new segment, or check back after records are added.</p>
        </EmptyState>
      }
    />
  );
}

function SegmentView() {
  const segmentId = useParam('segmentId');
  const { state, retry } = useLoad(loadSegment, segmentId);
  return (
    <WhenLoaded state={state} label="Loading the segment" retry={retry}>
      {(segment) => (
        <div className="flex flex-col gap-stack">
          <PageHeader
            title={segment.name}
            description={`Version ${String(segment.version)}. The members are worked out each time you open this page. Nothing is sent to a segment.`}
            breadcrumbs={[{ label: 'Segments', to: SEGMENTS_PATH }, { label: segment.name }]}
          />
          <Panel title="Filters">
            <ul className="list-disc pl-5">
              {Object.entries(segment.filters).map(([id, filter]) => (
                <li key={id}>{filterWords(filter)}</li>
              ))}
            </ul>
          </Panel>
          <Members segmentId={segmentId} />
        </div>
      )}
    </WhenLoaded>
  );
}

/** One segment: its filters in words and who matches now. */
export default function SegmentPage() {
  return (
    <Needs permission="crm.records.read">
      <SegmentView />
    </Needs>
  );
}
