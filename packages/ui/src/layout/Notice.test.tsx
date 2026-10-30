// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Notice } from './Notice.tsx';
import type { NoticeTone } from './Notice.tsx';

const tones: readonly [NoticeTone, string][] = [
  ['neutral', 'bg-sunken'],
  ['info', 'bg-info-soft'],
  ['success', 'bg-success-soft'],
  ['warning', 'bg-warning-soft'],
  ['danger', 'bg-danger-soft'],
];

describe('Notice', () => {
  it('says its point in words, with what follows from it and an action', () => {
    render(
      <Notice title="Applicants see nothing yet" action={<button type="button">Release</button>}>
        They are told when you release decisions.
      </Notice>,
    );

    expect(screen.getByText('Applicants see nothing yet')).toBeTruthy();
    expect(screen.getByText('They are told when you release decisions.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release' })).toBeTruthy();
  });

  it('leaves out the body and the action when it has none', () => {
    const { container } = render(<Notice title="Saved" />);

    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides its mark from assistive technology', () => {
    const { container } = render(<Notice title="Saved" icon="lock" />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each(tones)('gives the %s tone its own background', (tone, background) => {
    const { container } = render(<Notice tone={tone} title="Saved" />);

    expect((container.firstElementChild as HTMLElement).className).toContain(background);
  });

  it('is not a live region until the page makes it one', () => {
    render(<Notice tone="success" title="Saved" />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
