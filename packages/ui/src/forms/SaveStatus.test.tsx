// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveStatus } from './SaveStatus.tsx';

describe('SaveStatus', () => {
  it('is a polite live region from the start, with nothing in it before the first save', () => {
    render(<SaveStatus state={{ status: 'idle' }} />);

    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
  });

  it('says it is saving', () => {
    render(<SaveStatus state={{ status: 'saving' }} />);

    expect(screen.getByRole('status').textContent).toBe('Saving…');
  });

  it('says when it saved, in the content style for times', () => {
    const { rerender } = render(
      <SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 14, 14) }} />,
    );
    expect(screen.getByRole('status').textContent).toBe('Saved at 2:14pm');

    rerender(<SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 9, 5) }} />);
    expect(screen.getByRole('status').textContent).toBe('Saved at 9:05am');

    rerender(<SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 17, 0) }} />);
    expect(screen.getByRole('status').textContent).toBe('Saved at 5pm');

    rerender(<SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 0, 30) }} />);
    expect(screen.getByRole('status').textContent).toBe('Saved at 12:30am');

    rerender(<SaveStatus state={{ status: 'saved', at: new Date(2026, 9, 20, 12, 0) }} />);
    expect(screen.getByRole('status').textContent).toBe('Saved at 12pm');
  });

  it('says it did not save, and what to do', () => {
    render(<SaveStatus state={{ status: 'failed' }} />);

    expect(screen.getByRole('status').textContent).toBe(
      'Not saved. Check your connection and try again',
    );
  });

  it('keeps one element as the state changes, so a screen reader announces each change', () => {
    const { rerender } = render(<SaveStatus state={{ status: 'saving' }} />);
    const region = screen.getByRole('status');

    rerender(<SaveStatus state={{ status: 'failed' }} />);

    expect(screen.getByRole('status')).toBe(region);
  });
});
