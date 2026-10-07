// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from './DataTable.tsx';
import type { Column, DataTableProps } from './DataTable.tsx';

interface Row {
  reference: string;
  organisation: string;
  amount: number;
}

const rows: readonly Row[] = [
  { reference: 'CG27-0101', organisation: 'Brightwater Community Trust', amount: 12500 },
  { reference: 'CG27-0102', organisation: 'Harbourside Youth Project', amount: 24000 },
];

const columns: readonly Column<Row>[] = [
  { key: 'reference', header: 'Reference', cell: (row) => row.reference },
  { key: 'organisation', header: 'Organisation', rowHeader: true, cell: (row) => row.organisation },
  {
    key: 'amount',
    header: 'Amount requested',
    align: 'end',
    sortable: true,
    cell: (row) => `£${row.amount.toLocaleString('en-GB')}`,
  },
];

function Example(props: Partial<DataTableProps<Row>>) {
  return (
    <DataTable
      caption="Spring round submissions"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.reference}
      {...props}
    />
  );
}

describe('DataTable', () => {
  it('is a table named by its caption, in a focusable region with the same name', () => {
    render(<Example />);

    expect(screen.getByRole('table', { name: 'Spring round submissions' })).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Spring round submissions' });
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain('overflow-x-auto');
  });

  it('positions the scroll region, so visually hidden text in a far-right cell cannot widen the page', () => {
    render(<Example />);

    const region = screen.getByRole('region', { name: 'Spring round submissions' });
    expect(region.className).toContain('relative');
  });

  it('keeps the caption for screen readers only when asked', () => {
    const { rerender } = render(<Example />);
    const caption = () => screen.getByText('Spring round submissions');
    expect(caption().className).not.toContain('sr-only');

    rerender(<Example captionHidden />);
    expect(caption().className).toContain('sr-only');
    expect(screen.getByRole('table', { name: 'Spring round submissions' })).toBeTruthy();
  });

  it('has a column header for each column and a row header for the row header column', () => {
    render(<Example />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Reference',
      'Organisation',
      'Amount requested',
    ]);
    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders.map((header) => header.textContent)).toEqual([
      'Brightwater Community Trust',
      'Harbourside Youth Project',
    ]);
    expect(rowHeaders.every((header) => header.getAttribute('scope') === 'row')).toBe(true);
    expect(
      screen.getAllByRole('columnheader').every((header) => header.getAttribute('scope') === 'col'),
    ).toBe(true);
  });

  it('shows the cells of each row in column order', () => {
    render(<Example />);

    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect([...row.querySelectorAll('th, td')].map((cell) => cell.textContent)).toEqual([
      'CG27-0101',
      'Brightwater Community Trust',
      '£12,500',
    ]);
  });

  it('puts a button in a sortable heading only, and no sort on the others', () => {
    render(<Example />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Amount requested',
    ]);
    expect(
      screen.getAllByRole('columnheader').map((header) => header.getAttribute('aria-sort')),
    ).toEqual([null, null, null]);
  });

  it('marks the sorted column with aria-sort, and the arrow is decorative', () => {
    render(<Example sort={{ key: 'amount', direction: 'descending' }} />);

    const header = screen.getByRole('columnheader', { name: 'Amount requested' });
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(header.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('columnheader', { name: 'Reference' }).hasAttribute('aria-sort')).toBe(
      false,
    );
  });

  it('asks for ascending order on a new column, then flips the direction', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const { rerender } = render(<Example onSortChange={onSortChange} />);

    await user.click(screen.getByRole('button', { name: 'Amount requested' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'amount', direction: 'ascending' });

    rerender(
      <Example onSortChange={onSortChange} sort={{ key: 'amount', direction: 'ascending' }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Amount requested' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'amount', direction: 'descending' });

    rerender(
      <Example onSortChange={onSortChange} sort={{ key: 'amount', direction: 'descending' }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Amount requested' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'amount', direction: 'ascending' });
  });

  it('sorts from the keyboard', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(<Example onSortChange={onSortChange} />);

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Amount requested' }));
    await user.keyboard('{Enter}');
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it('shows the rows in the order given', () => {
    render(<Example rows={[...rows].reverse()} />);

    expect(screen.getAllByRole('rowheader').map((header) => header.textContent)).toEqual([
      'Harbourside Youth Project',
      'Brightwater Community Trust',
    ]);
  });

  it('shows the empty message in one cell across the table when there are no rows', () => {
    render(<Example rows={[]} empty={<p>No applications yet</p>} />);

    const cell = screen.getByRole('cell', { name: 'No applications yet' });
    expect(cell.getAttribute('colspan')).toBe(String(columns.length));
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('does not show the empty message when there are rows', () => {
    render(<Example empty={<p>No applications yet</p>} />);

    expect(screen.queryByText('No applications yet')).toBeNull();
  });
});
