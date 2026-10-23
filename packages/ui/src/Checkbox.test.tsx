// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox.tsx';

describe('Checkbox', () => {
  it('is named by its label and reports a change', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Late only" checked={false} onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole('checkbox', { name: 'Late only' }));

    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('is ticked with Space', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Late only" checked onCheckedChange={onCheckedChange} />);

    await user.tab();
    await user.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('keeps a hidden label for screen readers', () => {
    render(
      <Checkbox label="Select Riverside" labelHidden checked={false} onCheckedChange={vi.fn()} />,
    );

    expect(screen.getByText('Select Riverside').className).toContain('sr-only');
    expect(screen.getByRole('checkbox', { name: 'Select Riverside' })).toBeTruthy();
  });

  it('shows some of a group ticked as mixed', () => {
    const { rerender } = render(
      <Checkbox label="All" indeterminate checked={false} onCheckedChange={vi.fn()} />,
    );
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'All' });
    expect(box.indeterminate).toBe(true);

    rerender(<Checkbox label="All" checked={false} onCheckedChange={vi.fn()} />);
    expect(box.indeterminate).toBe(false);
  });
});
