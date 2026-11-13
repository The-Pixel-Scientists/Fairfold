// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './Combobox.tsx';
import type { ComboboxGroup, ComboboxProps } from './Combobox.tsx';

const groups: ComboboxGroup[] = [
  {
    id: 'a',
    label: 'First tool',
    options: [
      { id: 'a1', label: 'Alpha one', secondary: 'REF-1' },
      { id: 'a2', label: 'Alpha two' },
    ],
    note: 'More results in First tool',
  },
  { id: 'b', label: 'Second tool', options: [{ id: 'b1', label: 'Beta one' }] },
];

function Example(props: Partial<ComboboxProps>) {
  const [value, setValue] = useState('');
  return (
    <>
      <Combobox
        label="Search"
        hint="Press Ctrl+K"
        value={value}
        onValueChange={setValue}
        groups={groups}
        onSelect={() => undefined}
        {...props}
      />
      <button type="button">After</button>
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Search' });

Element.prototype.scrollIntoView = () => undefined;

describe('Combobox', () => {
  it('is an editable combobox with a named listbox that starts closed', () => {
    render(<Example />);
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box().getAttribute('aria-autocomplete')).toBe('list');
    expect(box().getAttribute('autocomplete')).toBe('off');
    expect(box().getAttribute('aria-describedby')).toBe(screen.getByText('Press Ctrl+K').id);
    expect(box().getAttribute('aria-controls')).toBe(
      document.querySelector('[role="listbox"]')?.id,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on typing, with labelled groups of options and no option for a heading', async () => {
    render(<Example />);
    await userEvent.type(box(), 'al');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Search' }).hidden).toBe(false);
    expect(screen.getByRole('group', { name: 'First tool' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Second tool' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('More results in First tool')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /First tool/ })).toBeNull();
  });

  it('moves the highlight across groups with the arrows and keeps focus in the input', async () => {
    render(<Example />);
    await userEvent.type(box(), 'al');
    const options = screen.getAllByRole('option');
    await userEvent.keyboard('{ArrowDown}');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(options[2]?.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(box());
  });

  it('opens the highlighted option with Enter', async () => {
    const onSelect = vi.fn();
    render(<Example onSelect={onSelect} />);
    await userEvent.type(box(), 'al');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('a2');
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on the first Escape, clears on the second, and reopens with Alt+Down', async () => {
    render(<Example />);
    await userEvent.type(box(), 'al');
    await userEvent.keyboard('{Escape}');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect((box() as HTMLInputElement).value).toBe('al');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().hasAttribute('aria-activedescendant')).toBe(false);
    await userEvent.keyboard('{Escape}{Escape}');
    expect((box() as HTMLInputElement).value).toBe('');
  });

  it('closes on Tab without choosing', async () => {
    const onSelect = vi.fn();
    render(<Example onSelect={onSelect} />);
    await userEvent.type(box(), 'al');
    await userEvent.keyboard('{ArrowDown}{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens an option on click and closes on a click outside', async () => {
    const onSelect = vi.fn();
    render(<Example onSelect={onSelect} />);
    await userEvent.type(box(), 'al');
    await userEvent.click(screen.getByRole('option', { name: /Beta one/ }));
    expect(onSelect).toHaveBeenCalledWith('b1');
    await userEvent.type(box(), 'x');
    await userEvent.click(document.body);
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('says what is loading and what the status is', () => {
    render(<Example loading status="3 results in 2 tools" />);
    expect(screen.getByRole('status').textContent).toBe('3 results in 2 tools');
    expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('true');
  });
});
