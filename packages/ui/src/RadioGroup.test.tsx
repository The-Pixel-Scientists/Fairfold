// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { RadioGroup } from './RadioGroup.tsx';
import type { RadioGroupProps } from './RadioGroup.tsx';

const options = [
  { value: 'standard', label: 'Standard', hint: 'Small rounded corners.' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'square', label: 'Square' },
];

function Example(props: Partial<RadioGroupProps>) {
  const [value, setValue] = useState('standard');
  return (
    <RadioGroup
      legend="Preset"
      name="preset"
      value={value}
      onValueChange={setValue}
      options={options}
      {...props}
    />
  );
}

const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

describe('RadioGroup', () => {
  it('is a group named by its legend, with a radio button for each choice and one checked', () => {
    render(<Example />);

    expect(screen.getByRole('group', { name: 'Preset' })).toBeTruthy();
    expect(screen.getAllByRole<HTMLInputElement>('radio').map(({ checked }) => checked)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('describes a choice by its hint without making the hint part of its name', () => {
    render(<Example />);

    expect(radio('Standard').getAttribute('aria-describedby')).toBe(
      screen.getByText('Small rounded corners.').id,
    );
    expect(radio('Rounded').getAttribute('aria-describedby')).toBeNull();
  });

  it('chooses with a click on the radio button or its label', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByText('Rounded'));
    expect(radio('Rounded').checked).toBe(true);
    await user.click(radio('Square'));
    expect(radio('Square').checked).toBe(true);
    expect(radio('Rounded').checked).toBe(false);
  });

  it('is one tab stop, and the arrow keys move between the choices', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Example />
        <button type="button">After</button>
      </>,
    );

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(radio('Standard'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radio('Rounded'));
    expect(radio('Rounded').checked).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });

  it('describes the group by its hint and error', () => {
    render(<Example hint="Changes the corners." error="Choose a preset." />);

    const group = screen.getByRole('group', { name: 'Preset' });
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Changes the corners.',
      'Error: Choose a preset.',
    ]);
  });

  it('gives its id to the first radio button, so an error summary can link to it', () => {
    render(<Example id="f_preset" />);

    expect(screen.getAllByRole('radio').map(({ id }) => id)).toEqual([
      'f_preset',
      'f_preset-1',
      'f_preset-2',
    ]);
  });
});
