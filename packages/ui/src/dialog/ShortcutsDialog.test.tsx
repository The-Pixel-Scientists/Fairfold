import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ShortcutsDialog } from './ShortcutsDialog.tsx';

const groups = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move between rows' },
      { keys: ['Enter'], does: 'Open the submission' },
    ],
  },
];

describe('ShortcutsDialog', () => {
  it('is a dialog that lists each shortcut under its group', () => {
    render(
      <ShortcutsDialog
        open
        onOpenChange={vi.fn()}
        groups={groups}
        description="These work when a row has focus."
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('These work when a row has focus.')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { level: 3, name: 'In the table' })).toBeTruthy();
    expect(within(dialog).getByText('Move between rows')).toBeTruthy();
    expect(dialog.querySelectorAll('kbd')).toHaveLength(3);
    expect(within(dialog).getByText('Enter').tagName).toBe('KBD');
  });

  it('starts on its Close button, which closes it', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ShortcutsDialog open onOpenChange={onOpenChange} groups={groups} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Enter}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows nothing while closed', () => {
    render(<ShortcutsDialog open={false} onOpenChange={vi.fn()} groups={groups} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
