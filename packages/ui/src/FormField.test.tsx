// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FormField, Input, Textarea, useFormFieldControl } from './FormField.tsx';

describe('FormField', () => {
  it('labels the control, so the label names it and clicking the label focuses it', async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Programme name">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Programme name' });
    await user.click(screen.getByText('Programme name'));

    expect(document.activeElement).toBe(input);
  });

  it('describes the control by its hint', () => {
    render(
      <FormField label="Closing date" hint="For example, 1 April 2027">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Closing date' });
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByText('For example, 1 April 2027').id,
    );
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/Error:/)).toBeNull();
  });

  it('describes the control by its error too, and marks it invalid', () => {
    render(
      <FormField
        label="Closing date"
        hint="For example, 1 April 2027"
        error="Enter a date after 1 April 2027"
      >
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Closing date' });
    const hint = screen.getByText('For example, 1 April 2027');
    const error = screen.getByText('Enter a date after 1 April 2027').closest('p');
    expect(error).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(`${hint.id} ${error?.id ?? ''}`);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The description a screen reader reads carries the word "Error".
    expect(
      screen.getByRole('textbox', {
        name: 'Closing date',
        description: 'For example, 1 April 2027 Error: Enter a date after 1 April 2027',
      }),
    ).toBe(input);
  });

  it('describes the control by the error alone when there is no hint', () => {
    render(
      <FormField label="Email address" error="Enter an email address">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Email address' });
    expect(input.getAttribute('aria-describedby')).toMatch(/-error$/);
  });

  it('adds "(optional)" to the label when the field is optional', () => {
    render(
      <FormField label="Website" optional>
        <Input />
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: 'Website (optional)' })).toBeTruthy();
  });

  it('uses the id you give it, so an error summary can link to the field', () => {
    render(
      <FormField label="Email address" id="email">
        <Input />
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: 'Email address' }).id).toBe('email');
  });

  it('gives each field its own id', () => {
    render(
      <>
        <FormField label="First name">
          <Input />
        </FormField>
        <FormField label="Last name">
          <Input />
        </FormField>
      </>,
    );
    const ids = screen.getAllByRole('textbox').map((input) => input.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toBe('');
  });

  it('wires a textarea the same way', () => {
    render(
      <FormField label="Summary" hint="Up to 500 words" error="Enter a summary">
        <Textarea />
      </FormField>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Summary' });
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });

  it('keeps a description you give the control yourself', () => {
    render(
      <FormField label="Closing date" hint="For example, 1 April 2027">
        <Input aria-describedby="extra" />
      </FormField>,
    );
    const describedBy = screen
      .getByRole('textbox', { name: 'Closing date' })
      .getAttribute('aria-describedby');
    expect(describedBy?.split(' ')).toContain('extra');
    expect(describedBy?.split(' ')).toHaveLength(2);
  });

  it('lets your own control read its wiring from useFormFieldControl', () => {
    function Rating() {
      const field = useFormFieldControl();
      return (
        <select {...field}>
          <option>Strong</option>
        </select>
      );
    }
    render(
      <FormField label="Rating" error="Choose a rating">
        <Rating />
      </FormField>,
    );
    const select = screen.getByRole('combobox', { name: 'Rating' });
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });

  it('lets a control work on its own, outside a field', () => {
    render(<Input aria-label="Search applications" />);
    const input = screen.getByRole('textbox', { name: 'Search applications' });
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('can be typed into', async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Programme name">
        <Input />
      </FormField>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Programme name' }), 'Small grants');
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Small grants');
  });
});
