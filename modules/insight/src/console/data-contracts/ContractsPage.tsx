// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Link, PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { DataContractList } from '../../contracts/index.ts';
import { loadDataContracts } from '../api.ts';
import { plainName } from '../format.ts';
import { insightPath } from '../paths.ts';

type Contract = DataContractList['contracts'][number];

const columns: readonly Column<Contract>[] = [
  {
    key: 'module',
    header: 'Module',
    rowHeader: true,
    cell: (row) => (
      <Link to={insightPath('contract', { module: row.module })} className="font-medium underline">
        {plainName(row.module)}
      </Link>
    ),
  },
  {
    key: 'version',
    header: 'Contract version',
    align: 'end',
    cell: (row) => row.version ?? 'Not built yet',
  },
  { key: 'tables', header: 'Tables', align: 'end', cell: (row) => row.tables.length },
];

export default function ContractsPage() {
  const { state, retry } = useLoad(loadDataContracts);
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Data contracts"
        description="The data each module contributes to the warehouse. This lists the structure only; it holds none of your data."
      />
      <WhenLoaded state={state} label="Loading data contracts" retry={retry}>
        {({ contracts }) => (
          <DataTable
            caption="Data contracts by module"
            captionHidden
            columns={columns}
            rows={contracts}
            rowKey={(row) => row.module}
          />
        )}
      </WhenLoaded>
    </div>
  );
}
