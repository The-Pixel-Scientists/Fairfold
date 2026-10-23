import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button.tsx';
import { BulkActionBar } from './BulkActionBar.tsx';

const noun = { one: 'submission', other: 'submissions' };

function Example({ count, onClear = vi.fn() }: { count: number; onClear?: () => void }) {
  return (
    <BulkActionBar count={count} noun={noun} onClear={onClear}>
      <Button disabled={count === 0}>Move to stage</Button>
    </BulkActionBar>
  );
}

describe('BulkActionBar', () => {
  it('is a named group that says what to do while nothing is selected', () => {
    render(<Example count={0} />);

    const group = screen.getByRole('group', { name: 'Bulk actions' });
    expect(group.textContent).toContain('Select submissions to act on several at once.');
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
    const move = screen.getByRole<HTMLButtonElement>('button', { name: 'Move to stage' });
    expect(move.disabled).toBe(true);
  });

  it('says how many are selected in a polite live region, in the singular or the plural', () => {
    const { rerender } = render(<Example count={1} />);
    const live = screen.getByText('1 submission selected').closest('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');

    rerender(<Example count={5} />);
    expect(screen.getByText('5 submissions selected')).toBeTruthy();
  });

  it('clears the selection and keeps focus in the bar', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<Example count={3} onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    const group = screen.getByRole('group', { name: 'Bulk actions' });
    expect(group.contains(document.activeElement)).toBe(true);
  });
});
