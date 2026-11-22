// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  Tag,
  useCan,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { FrameworkList } from '../contracts/index.ts';
import { loadFrameworks } from './loaders.ts';
import { Gate, LinkButton } from './Page.tsx';
import { frameworkPath, NEW_FRAMEWORK_PATH } from './paths.ts';
import { formatDay } from './words.ts';

type Row = FrameworkList['frameworks'][number];

const columns: readonly Column<Row>[] = [
  {
    key: 'name',
    header: 'Framework',
    rowHeader: true,
    cell: (row) => (
      <span className="flex min-w-48 max-w-96 flex-col whitespace-normal">
        <Link to={frameworkPath(row.id)}>{row.name}</Link>
        {row.description !== '' && (
          <span className="text-sm font-normal text-muted">{row.description}</span>
        )}
      </span>
    ),
  },
  { key: 'outcomes', header: 'Outcomes', align: 'end', cell: (row) => row.outcomeCount },
  { key: 'indicators', header: 'Indicators', align: 'end', cell: (row) => row.indicatorCount },
  {
    key: 'status',
    header: 'Status',
    cell: (row) =>
      row.archivedAt === null ? <Tag tone="info">Active</Tag> : <Tag tone="neutral">Archived</Tag>,
  },
  { key: 'updated', header: 'Last changed', cell: (row) => formatDay(row.updatedAt) },
];

function Frameworks() {
  const { state, retry } = useLoad(loadFrameworks);
  const manage = useCan('impact.frameworks.manage');
  return (
    <>
      <PageHeader
        title="Impact"
        description="An outcomes framework lists the changes you want your grants to make and the indicators that show them. Open one to set targets and record results."
        actions={
          manage && (
            <LinkButton to={NEW_FRAMEWORK_PATH} variant="primary">
              New framework
            </LinkButton>
          )
        }
      />
      <WhenLoaded state={state} label="Loading frameworks" retry={retry}>
        {({ frameworks }) =>
          frameworks.length === 0 ? (
            <EmptyState
              title="No outcomes frameworks yet"
              action={manage && <LinkButton to={NEW_FRAMEWORK_PATH}>Create a framework</LinkButton>}
            >
              <p>
                {manage
                  ? 'A framework lists the outcomes you want to see, such as people feeling less isolated, with an indicator for each. Create one, then set targets and record results against it.'
                  : 'Nothing has been set up yet. Ask someone who can set up outcomes to create a framework.'}
              </p>
            </EmptyState>
          ) : (
            <DataTable
              caption="Outcomes frameworks"
              captionHidden
              columns={columns}
              rows={frameworks}
              rowKey={(row) => row.id}
            />
          )
        }
      </WhenLoaded>
    </>
  );
}

/** The funder's outcomes frameworks, archived ones last. */
export default function FrameworksPage() {
  return (
    <Gate permission="impact.frameworks.read" title="Impact">
      <Frameworks />
    </Gate>
  );
}
