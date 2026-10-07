// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stats } from './Stats.tsx';

const items = [
  { label: 'Applications received', value: '48', detail: '12 in the last week' },
  { label: 'Total requested', value: '£612,400' },
];

/** The tile that holds a label. */
function tileOf(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('dl > div');
  if (!(tile instanceof HTMLElement)) throw new Error(`No tile holds ${label}.`);
  return tile;
}

describe('Stats', () => {
  it('is a group named by its label, which is not shown', () => {
    render(<Stats label="Spring 2027 round" items={items} />);

    const group = screen.getByRole('group', { name: 'Spring 2027 round' });
    expect(group.textContent).not.toContain('Spring 2027 round');
  });

  it('gives each tile a label and a value', () => {
    render(<Stats label="Spring 2027 round" items={items} />);

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Applications received',
      'Total requested',
    ]);
    const values = screen.getAllByRole('definition').map((value) => value.textContent);
    expect(values).toEqual(['48', '12 in the last week', '£612,400']);
  });

  it('shows a detail only when the tile has one', () => {
    render(<Stats label="Spring 2027 round" items={items} />);

    expect(within(tileOf('Applications received')).getAllByRole('definition')).toHaveLength(2);
    expect(within(tileOf('Total requested')).getAllByRole('definition')).toHaveLength(1);
  });

  it('sets the values large, semibold and in digits of equal width', () => {
    render(<Stats label="Spring 2027 round" items={items} />);

    const classes = screen.getByText('48').className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['text-2xl', 'font-semibold', 'tabular-nums']));
  });

  it('lays the tiles out in a grid that wraps to fit', () => {
    render(<Stats label="Spring 2027 round" items={items} />);

    expect(document.querySelector('dl')?.className).toContain('auto-fit');
  });
});
