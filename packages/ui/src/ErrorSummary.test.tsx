// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ErrorSummary } from './ErrorSummary.tsx';
import type { ErrorSummaryItem } from './ErrorSummary.tsx';
import { FormField, Input } from './FormField.tsx';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const errors: ErrorSummaryItem[] = [
  { fieldId: 'name', message: 'Enter a programme name' },
  { fieldId: 'email', message: 'Enter an email address' },
];

function Form({ items }: { items: readonly ErrorSummaryItem[] }) {
  return (
    <form noValidate>
      <ErrorSummary errors={items} />
      <FormField id="name" label="Programme name" error={items[0]?.message}>
        <Input />
      </FormField>
      <FormField id="email" label="Email address" error={items[1]?.message}>
        <Input type="email" />
      </FormField>
    </form>
  );
}

describe('ErrorSummary', () => {
  it('renders nothing when there are no errors', () => {
    render(<Form items={[]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is an alert with a heading, and lists every problem as a link to its field', () => {
    render(<Form items={errors} />);

    const alert = screen.getByRole('alert', { name: 'There is a problem' });
    expect(alert.querySelector('h2')?.textContent).toBe('There is a problem');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Enter a programme name',
      'Enter an email address',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#name', '#email']);
  });

  it('takes focus when the errors appear, so a screen reader reads it', () => {
    render(<Form items={errors} />);
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByRole('alert').getAttribute('tabindex')).toBe('-1');
  });

  it('takes focus when errors appear on a form that was valid', () => {
    const { rerender } = render(<Form items={[]} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<Form items={errors} />);

    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('does not take focus back when the list changes while the person fixes a field', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Form items={errors} />);
    const name = screen.getByRole('textbox', { name: /Programme name/ });
    await user.click(name);

    rerender(<Form items={errors.slice(1)} />);

    expect(document.activeElement).toBe(name);
  });

  it('takes focus again when it is given a new key, after another failed submit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <ErrorSummary key={1} errors={errors} />
        <button type="button">Save programme</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Save programme' }));
    expect(document.activeElement).not.toBe(screen.getByRole('alert'));

    rerender(
      <>
        <ErrorSummary key={2} errors={errors} />
        <button type="button">Save programme</button>
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('moves focus to the field when a message is clicked, and leaves the address alone', async () => {
    const user = userEvent.setup();
    render(<Form items={errors} />);

    await user.click(screen.getByRole('link', { name: 'Enter an email address' }));

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Email address/ }));
    expect(window.location.hash).toBe('');
  });

  it('works from the keyboard: Tab to a message and press Enter', async () => {
    const user = userEvent.setup();
    render(<Form items={errors} />);

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Enter a programme name' }),
    );
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Programme name/ }));
  });

  it('accepts a title of its own', () => {
    render(<ErrorSummary errors={errors} title="Fix these before you continue" />);
    expect(screen.getByRole('alert', { name: 'Fix these before you continue' })).toBeTruthy();
  });
});
