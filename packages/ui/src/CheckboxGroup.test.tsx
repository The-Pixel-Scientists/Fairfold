// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { CheckboxGroup } from './CheckboxGroup.tsx';
import type { CheckboxGroupProps } from './CheckboxGroup.tsx';

const options = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
];

function Example(props: Partial<CheckboxGroupProps>) {
  const [values, setValues] = useState<readonly string[]>(['south']);
  return (
    <CheckboxGroup
      legend="Regions"
      name="regions"
      values={values}
      onValuesChange={setValues}
      options={options}
      {...props}
    />
  );
}

const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });

describe('CheckboxGroup', () => {
  it('is a group named by its legend, with a checkbox for each choice and the values ticked', () => {
    render(<Example />);

    expect(screen.getByRole('group', { name: 'Regions' })).toBeTruthy();
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map(({ checked }) => checked)).toEqual(
      [false, true, false],
    );
  });

  it('ticks and unticks with a click on the box or its label', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByText('North'));
    expect(box('North').checked).toBe(true);
    await user.click(box('South'));
    expect(box('South').checked).toBe(false);
  });

  it('makes each checkbox its own tab stop, ticked with the space bar', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.tab();
    expect(document.activeElement).toBe(box('North'));
    await user.tab();
    expect(document.activeElement).toBe(box('South'));
    await user.keyboard(' ');
    expect(box('South').checked).toBe(false);
  });

  it('reports the ticked values in the order of the options, not the order of the clicks', async () => {
    const user = userEvent.setup();
    const reported: string[][] = [];
    render(
      <Example
        values={[]}
        onValuesChange={(values) => {
          reported.push(values);
        }}
      />,
    );

    await user.click(box('East'));
    expect(reported.at(-1)).toEqual(['east']);
  });

  it('describes the group by its hint and error', () => {
    render(<Example hint="Choose all that apply." error="Choose at least one region." />);

    const group = screen.getByRole('group', { name: 'Regions' });
    const described = (group.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Choose all that apply.',
      'Error: Choose at least one region.',
    ]);
  });

  it('gives its id to the first checkbox, so an error summary can link to it', () => {
    render(<Example id="f_regions" />);

    expect(screen.getAllByRole('checkbox').map(({ id }) => id)).toEqual([
      'f_regions',
      'f_regions-1',
      'f_regions-2',
    ]);
  });
});
