// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tag } from './Tag.tsx';
import type { TagTone } from './Tag.tsx';

const tones: readonly [TagTone, string, string][] = [
  ['neutral', 'bg-sunken', 'text-ink'],
  ['info', 'bg-info-soft', 'text-info'],
  ['success', 'bg-success-soft', 'text-success'],
  ['warning', 'bg-warning-soft', 'text-warning'],
  ['danger', 'bg-danger-soft', 'text-danger'],
];

describe('Tag', () => {
  it('says the status in words, and only the words', () => {
    render(<Tag tone="success">Awarded</Tag>);

    expect(screen.getByText('Awarded').textContent).toBe('Awarded');
  });

  it('hides the dot from assistive technology', () => {
    render(<Tag>Draft</Tag>);

    const dot = screen.getByText('Draft').querySelector('span');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.textContent).toBe('');
  });

  it('is neutral unless you set a tone', () => {
    render(<Tag>Draft</Tag>);

    expect(screen.getByText('Draft').className).toContain('bg-sunken');
  });

  it.each(tones)(
    'gives the %s tone a soft background and its own text colour',
    (tone, background, text) => {
      render(<Tag tone={tone}>{tone}</Tag>);

      const classes = screen.getByText(tone).className.split(' ');
      expect(classes).toContain(background);
      expect(classes).toContain(text);
    },
  );

  it('never wraps a status onto two lines', () => {
    render(<Tag tone="warning">Conflict declared</Tag>);

    expect(screen.getByText('Conflict declared').className).toContain('whitespace-nowrap');
  });
});
