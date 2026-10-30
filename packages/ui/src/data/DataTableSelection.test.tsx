// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from './DataTable.tsx';
import type { Column } from './DataTable.tsx';

interface Row {
  id: string;
  organisation: string;
}

const rows: readonly Row[] = [
  { id: 'a', organisation: 'Brightwater Community Trust' },
  { id: 'b', organisation: 'Harbourside Youth Project' },
  { id: 'c', organisation: 'Millbrook Allotment Society' },
];

const columns: readonly Column<Row>[] = [
  {
    key: 'organisation',
    header: 'Organisation',
    rowHeader: true,
    cell: (row) => <a href={`#${row.id}`}>{row.organisation}</a>,
  },
];

function Example({
  onOpenRow,
  onHelp,
  initial = [],
}: {
  onOpenRow?: (row: Row) => void;
  onHelp?: () => void;
  initial?: readonly string[];
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  return (
    <>
      <p data-testid="count">{selected.size}</p>
      <DataTable
        caption="Submissions"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selection={{
          selected,
          onSelectedChange: setSelected,
          label: (row) => `Select ${row.organisation}`,
        }}
        {...(onOpenRow && { onOpenRow })}
        {...(onHelp && { onHelp })}
      />
    </>
  );
}

const count = () => screen.getByTestId('count').textContent;
const dataRows = () => screen.getAllByRole('row').slice(1);
const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });

describe('DataTable selection', () => {
  it('has a box in each row, named for the row, and one in the heading for the whole page', () => {
    render(<Example />);

    expect(screen.getAllByRole('checkbox').map((item) => item.parentElement?.textContent)).toEqual([
      'Select all on this page',
      'Select Brightwater Community Trust',
      'Select Harbourside Youth Project',
      'Select Millbrook Allotment Society',
    ]);
  });

  it('chooses a row from its box', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(box('Select Harbourside Youth Project'));

    expect(count()).toBe('1');
    expect(box('Select Harbourside Youth Project').checked).toBe(true);
  });

  it('chooses every row from the heading box, and shows it as mixed while only some are chosen', async () => {
    const user = userEvent.setup();
    render(<Example initial={['a']} />);
    const all = box('Select all on this page');
    expect(all.indeterminate).toBe(true);

    await user.click(all);
    expect(count()).toBe('3');
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);

    await user.click(all);
    expect(count()).toBe('0');
  });

  it('keeps rows chosen elsewhere when the heading box is used', async () => {
    const user = userEvent.setup();
    render(<Example initial={['elsewhere']} />);

    await user.click(box('Select all on this page'));
    expect(count()).toBe('4');
    await user.click(box('Select all on this page'));
    expect(count()).toBe('1');
  });

  it('spans the empty message across the box column too', () => {
    render(
      <DataTable
        caption="Submissions"
        columns={columns}
        rows={[]}
        rowKey={(row: Row) => row.id}
        empty={<p>Nothing here</p>}
        selection={{ selected: new Set(), onSelectedChange: vi.fn(), label: () => '' }}
      />,
    );

    expect(screen.getByRole('cell', { name: 'Nothing here' }).getAttribute('colspan')).toBe('2');
  });
});

describe('DataTable roving focus', () => {
  it('makes one row a Tab stop and takes the controls of the other rows out of the Tab order', async () => {
    const user = userEvent.setup();
    render(<Example />);

    expect(dataRows().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.tabIndex)).toEqual([0, -1, -1]);

    await user.tab(); // the table's scroll region
    await user.tab(); // the heading box
    await user.tab();
    expect(document.activeElement).toBe(dataRows()[0]);
    await user.tab();
    expect(document.activeElement).toBe(box('Select Brightwater Community Trust'));
    await user.tab();
    expect(document.activeElement).toBe(links[0]);
  });

  it('moves between rows with the arrow keys, Home and End, and the Tab stop moves with it', async () => {
    const user = userEvent.setup();
    render(<Example />);
    dataRows()[0]?.focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(dataRows()[1]);
    expect(dataRows().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getAllByRole('link').map((link) => link.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(dataRows()[2]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(dataRows()[2]);
    await user.keyboard('{ArrowUp}{Home}');
    expect(document.activeElement).toBe(dataRows()[0]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(dataRows()[0]);
  });

  it('chooses the focused row with Space', async () => {
    const user = userEvent.setup();
    render(<Example />);
    dataRows()[1]?.focus();

    await user.keyboard(' ');
    expect(count()).toBe('1');
    expect(box('Select Harbourside Youth Project').checked).toBe(true);
    await user.keyboard(' ');
    expect(count()).toBe('0');
  });

  it('opens the focused row with Enter, and leaves Enter on a link to the link', async () => {
    const user = userEvent.setup();
    const onOpenRow = vi.fn();
    render(<Example onOpenRow={onOpenRow} />);
    dataRows()[2]?.focus();

    await user.keyboard('{Enter}');
    expect(onOpenRow).toHaveBeenCalledExactlyOnceWith(rows[2]);

    screen.getAllByRole('link')[0]?.focus();
    await user.keyboard('{Enter}');
    expect(onOpenRow).toHaveBeenCalledTimes(1);
  });

  it('asks for the shortcuts with a question mark on a focused row only', async () => {
    const user = userEvent.setup();
    const onHelp = vi.fn();
    render(<Example onHelp={onHelp} />);

    box('Select all on this page').focus();
    await user.keyboard('?');
    expect(onHelp).not.toHaveBeenCalled();

    dataRows()[0]?.focus();
    await user.keyboard('?');
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it('leaves rows out of the Tab order when nothing can be done with them', () => {
    render(<DataTable caption="Plain" columns={columns} rows={rows} rowKey={(row) => row.id} />);

    expect(dataRows().map((row) => row.hasAttribute('tabindex'))).toEqual([false, false, false]);
    expect(screen.getAllByRole('link').map((link) => link.tabIndex)).toEqual([0, 0, 0]);
  });
});
