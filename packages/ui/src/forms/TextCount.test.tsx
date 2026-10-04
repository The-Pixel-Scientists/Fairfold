// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { helpers } from '../../test/forms.tsx';
import { TextCount } from './TextCount.tsx';

function visibleCount(text: string, limits: { maxWords?: number; maxCharacters?: number }) {
  const { container } = render(<TextCount id="count" text={text} helpers={helpers} {...limits} />);
  return container.querySelector('#count')?.textContent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TextCount', () => {
  it('counts the words left', () => {
    expect(visibleCount('one two', { maxWords: 5 })).toBe('You have 3 words left');
  });

  it('counts a whole answer left and none used', () => {
    expect(visibleCount('', { maxWords: 12 })).toBe('You have 12 words left');
  });

  it('says 0 words left at the limit, which is allowed', () => {
    expect(visibleCount('one two three', { maxWords: 3 })).toBe('You have 0 words left');
  });

  it('says how many words too many, and 1 word in the singular', () => {
    expect(visibleCount('one two three four', { maxWords: 3 })).toBe('You have 1 word too many');
    expect(visibleCount('one two three four five six', { maxWords: 3 })).toBe(
      'You have 3 words too many',
    );
  });

  it('says 1 word left in the singular', () => {
    expect(visibleCount('one two', { maxWords: 3 })).toBe('You have 1 word left');
  });

  it('counts words as the engine does: hyphens, numbers and line breaks, but not punctuation alone', () => {
    expect(visibleCount('well-known £25,000 \n\n – and so on', { maxWords: 10 })).toBe(
      'You have 5 words left',
    );
  });

  it('counts characters as code points', () => {
    expect(visibleCount('a😀b', { maxCharacters: 5 })).toBe('You have 2 characters left');
  });

  it('puts thousands in groups', () => {
    expect(visibleCount('', { maxCharacters: 20_000 })).toBe('You have 20,000 characters left');
  });

  it('shows a line for each limit', () => {
    render(<TextCount id="count" text="one" helpers={helpers} maxWords={2} maxCharacters={2} />);

    expect(screen.getByText('You have 1 word left')).toBeTruthy();
    expect(screen.getByText('You have 1 character too many')).toBeTruthy();
  });

  it('colours an answer that is over, and its words say so too', () => {
    const { container } = render(
      <TextCount id="count" text="one two" helpers={helpers} maxWords={1} />,
    );

    const line = container.querySelector('#count span');
    expect(line?.textContent).toBe('You have 1 word too many');
    expect(line?.className).toContain('text-danger');
  });

  it('tells a screen reader once typing stops, not at every key', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TextCount id="count" text="" helpers={helpers} maxWords={5} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('You have 5 words left');

    rerender(<TextCount id="count" text="one" helpers={helpers} maxWords={5} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(<TextCount id="count" text="one two" helpers={helpers} maxWords={5} />);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(status.textContent).toBe('You have 5 words left');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(status.textContent).toBe('You have 3 words left');
  });
});
