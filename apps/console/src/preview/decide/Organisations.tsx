// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: the organisations list, the front door to the party core
// that Fairfold CRM owns and every Fairfold tool reads.

import { Button, DataTable, FormField, Input, Link, PageHeader } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { useSort } from '../setup/sorting.ts';
import { pounds } from '../story.ts';
import { organisationRows } from './organisations-data.ts';
import type { OrganisationRow } from './organisations-data.ts';
import { Eyebrow } from './parts.tsx';

const columns: readonly Column<OrganisationRow>[] = [
  {
    key: 'name',
    header: 'Organisation',
    sortable: true,
    rowHeader: true,
    cell: (row) => (row.record === undefined ? row.name : <Link to={row.record}>{row.name}</Link>),
  },
  {
    key: 'charityNumber',
    header: 'Charity number',
    cell: (row) => row.charityNumber ?? <span className="text-muted">Not registered</span>,
  },
  { key: 'area', header: 'Area', sortable: true, cell: (row) => row.area },
  {
    key: 'applications',
    header: 'Applications',
    align: 'end',
    sortable: true,
    cell: (row) => row.applications,
  },
  {
    key: 'awarded',
    header: 'Grants to date',
    align: 'end',
    sortable: true,
    cell: (row) =>
      row.grants === 0 ? (
        <span className="text-muted">None yet</span>
      ) : (
        <span className="flex flex-col">
          {pounds(row.awarded)}
          <span className="text-sm font-normal text-muted">
            {row.grants} {row.grants === 1 ? 'grant' : 'grants'}
          </span>
        </span>
      ),
  },
];

const sortKeys = {
  name: (row: OrganisationRow) => row.name,
  area: (row: OrganisationRow) => row.area,
  applications: (row: OrganisationRow) => row.applications,
  awarded: (row: OrganisationRow) => row.awarded,
};

function matches(row: OrganisationRow, query: string): boolean {
  return [row.name, row.charityNumber ?? '', row.area].some((text) =>
    text.toLowerCase().includes(query.trim().toLowerCase()),
  );
}

/** Organisations the funder works with, each one record shared by every Fairfold tool. */
export default function Organisations() {
  const [query, setQuery] = useState('');
  const { sort, setSort, sorted } = useSort(organisationRows, sortKeys, {
    key: 'applications',
    direction: 'descending',
  });
  const shown = sorted.filter((row) => matches(row, query));

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        eyebrow={
          <Eyebrow>
            <span>Fairfold CRM</span>
          </Eyebrow>
        }
        title="Organisations"
        description="Every organisation you fund or hear from, kept as one record. Fairfold Grants and Fairfold Payments read the same record, so a detail is only ever changed once."
        actions={<Button variant="primary">Add organisation</Button>}
      />
      <form
        role="search"
        aria-label="Search organisations"
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2"
      >
        <FormField label="Search" className="w-full max-w-sm">
          <Input
            type="search"
            value={query}
            placeholder="Name, charity number or area"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </FormField>
        <p role="status" className="pb-2 text-sm text-muted">
          {`${String(shown.length)} of ${String(organisationRows.length)} organisations`}
        </p>
      </form>
      <DataTable
        caption="Organisations"
        captionHidden
        columns={columns}
        rows={shown}
        rowKey={(row) => row.name}
        {...(sort && { sort })}
        onSortChange={setSort}
        empty={
          <div className="flex flex-col items-start gap-2">
            <p className="font-medium text-ink">No organisations match your search</p>
            <p className="text-muted">
              Check the spelling, or search by charity number or area instead.
            </p>
            <Button
              onClick={() => {
                setQuery('');
              }}
            >
              Clear search
            </Button>
          </div>
        }
      />
    </div>
  );
}
