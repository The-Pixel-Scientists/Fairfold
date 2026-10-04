// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonClassName } from './Button.tsx';

describe('Button', () => {
  it('is a button that does not submit a form unless you ask', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button>Add reviewer</Button>
        <Button type="submit" variant="primary">
          Save programme
        </Button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Add reviewer' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save programme' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('can be used from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add reviewer</Button>);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add reviewer' }));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does nothing and leaves the tab order when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <Button disabled onClick={onClick}>
          Release decisions
        </Button>
        <Button>Add reviewer</Button>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Release decisions' }));
    await user.tab();

    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add reviewer' }));
  });

  it('passes other props through, such as a ref and an accessible description', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Button ref={ref} aria-describedby="help" className="extra">
        Add reviewer
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add reviewer' });
    expect(ref.current).toBe(button);
    expect(button.getAttribute('aria-describedby')).toBe('help');
    expect(button.className).toContain('extra');
  });

  it('is at least 24 by 24 pixels in every variant', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'quiet'] as const) {
      const classes = buttonClassName(variant).split(' ');
      expect(classes, variant).toContain('min-h-control');
      expect(classes, variant).toContain('min-w-target');
    }
  });

  it('keeps a border in every variant, so it stays visible in forced colours', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'quiet'] as const) {
      expect(buttonClassName(variant).split(' '), variant).toContain('border');
    }
  });
});
