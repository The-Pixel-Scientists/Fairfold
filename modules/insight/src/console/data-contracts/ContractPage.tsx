// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, EmptyState, PageHeader, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { DataContractList } from '../../contracts/index.ts';
import { loadDataContracts } from '../api.ts';
import { classLabels, plainName } from '../format.ts';
import { insightPath } from '../paths.ts';
import { Section } from '../parts.tsx';

type ContractColumn = DataContractList['contracts'][number]['tables'][number]['columns'][number];

const columns: readonly Column<ContractColumn>[] = [
  { key: 'name', header: 'Column', rowHeader: true, cell: (row) => <code>{row.name}</code> },
  { key: 'type', header: 'Type', cell: (row) => row.type + (row.nullable ? ', may be empty' : '') },
  {
    key: 'source',
    header: 'Source',
    cell: (row) =>
      row.sources.length === 0 ? 'Filled in by the warehouse load' : row.sources.join(', '),
  },
  { key: 'class', header: 'Class', cell: (row) => classLabels[row.class] },
];

export default function ContractPage({ module }: { module: string }) {
  const { state, retry } = useLoad(loadDataContracts);
  const title = `${plainName(module)} data contract`;
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Data contracts', to: insightPath('contracts') }, { label: title }]}
      />
      <WhenLoaded state={state} label="Loading the data contract" retry={retry}>
        {({ contracts }) => {
          const contract = contracts.find((item) => item.module === module);
          if (contract === undefined) {
            return (
              <EmptyState title="No data contract here">
                <p>Go back to the list of data contracts and choose a module.</p>
              </EmptyState>
            );
          }
          return (
            <>
              <p className="text-body text-muted">
                {contract.version === null
                  ? 'This module does not contribute data yet.'
                  : `Contract version ${String(contract.version)}, ${String(contract.tables.length)} tables.`}
              </p>
              {contract.tables.map((table) => (
                <Section key={table.name} title={plainName(table.name)}>
                  <p className="text-body text-muted">
                    One row for {table.rows}. Key: <code>{table.key}</code>.
                  </p>
                  <DataTable
                    caption={`Columns of ${plainName(table.name)}`}
                    captionHidden
                    columns={columns}
                    rows={table.columns}
                    rowKey={(row) => row.name}
                  />
                </Section>
              ))}
            </>
          );
        }}
      </WhenLoaded>
    </div>
  );
}
