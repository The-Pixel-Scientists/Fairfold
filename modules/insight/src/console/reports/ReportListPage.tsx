// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DataTable,
  Link,
  PageHeader,
  Tag,
  useCan,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { ReportDefinitionList } from '../../contracts/index.ts';
import { loadReports } from '../api.ts';
import { formatDate, reportKindLabels } from '../format.ts';
import { insightPath } from '../paths.ts';
import { LinkButton } from '../parts.tsx';

type Row = ReportDefinitionList['reports'][number];

const columns: readonly Column<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (row) => (
      <Link to={insightPath('report', { id: row.id })} className="font-medium underline">
        {row.name}
      </Link>
    ),
  },
  { key: 'kind', header: 'Kind', cell: (row) => reportKindLabels[row.kind] },
  { key: 'version', header: 'Version', align: 'end', cell: (row) => row.version },
  { key: 'updated', header: 'Last changed', cell: (row) => formatDate(row.updatedAt) },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (row.archivedAt === null ? 'In use' : <Tag>Archived</Tag>),
  },
];

export default function ReportListPage() {
  const canManage = useCan('insight.reports.manage');
  const { state, retry } = useLoad(loadReports);
  const create = (
    <LinkButton to={insightPath('report-new')} variant="primary">
      Create report
    </LinkButton>
  );
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Reports"
        description="Run a report to see its figures. Small numbers in equality monitoring reports are always hidden."
        actions={canManage ? create : undefined}
      />
      <WhenLoaded state={state} label="Loading reports" retry={retry}>
        {({ reports }) => (
          <DataTable
            caption="Reports"
            captionHidden
            columns={columns}
            rows={reports}
            rowKey={(row) => row.id}
            empty={
              <p>
                {canManage
                  ? 'There are no reports yet. Choose "Create report" to make the first.'
                  : 'There are no reports yet. Ask someone who sets up reports to make one.'}
              </p>
            }
          />
        )}
      </WhenLoaded>
    </div>
  );
}
