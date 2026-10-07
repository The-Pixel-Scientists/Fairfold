// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Meter } from './Meter.tsx';

const fill = (): HTMLElement => {
  const bar = screen.getByRole('meter').firstElementChild;
  if (!(bar instanceof HTMLElement)) throw new Error('The meter has no fill.');
  return bar;
};

describe('Meter', () => {
  it('is a meter with its value, range and words', () => {
    render(<Meter label="Average score" value={3.8} max={5} valueText="3.8 of 5" />);

    const meter = screen.getByRole('meter', { name: 'Average score' });
    expect(meter.getAttribute('aria-valuenow')).toBe('3.8');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('5');
    expect(meter.getAttribute('aria-valuetext')).toBe('3.8 of 5');
  });

  it('is named by the label that is shown, and shows the value in words beside it', () => {
    render(
      <Meter
        label="Budget committed"
        value={187_500}
        max={250_000}
        valueText="£187,500 of £250,000"
      />,
    );

    const name = screen.getByText('Budget committed');
    expect(screen.getByRole('meter').getAttribute('aria-labelledby')).toBe(name.id);
    expect(screen.getByText('£187,500 of £250,000')).toBeTruthy();
  });

  it('fills the share of the range that the value covers', () => {
    render(
      <Meter
        label="Budget committed"
        value={187_500}
        max={250_000}
        valueText="£187,500 of £250,000"
      />,
    );

    expect(fill().style.width).toBe('75%');
  });

  it('measures from the minimum when you set one', () => {
    render(<Meter label="Rating" value={4} min={2} max={6} valueText="4 out of 6, from 2" />);

    expect(screen.getByRole('meter').getAttribute('aria-valuemin')).toBe('2');
    expect(fill().style.width).toBe('50%');
  });

  it('keeps a value outside the range inside it', () => {
    const { rerender } = render(
      <Meter
        label="Budget committed"
        value={262_000}
        max={250_000}
        valueText="£262,000 of £250,000"
      />,
    );
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('250000');
    expect(fill().style.width).toBe('100%');

    rerender(
      <Meter label="Budget committed" value={-5} max={250_000} valueText="Nothing committed" />,
    );
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
    expect(fill().style.width).toBe('0%');
  });

  it('shows an empty bar for a range with no width', () => {
    render(<Meter label="Reviews done" value={0} max={0} valueText="No reviews assigned" />);

    expect(fill().style.width).toBe('0%');
  });

  it('is accent unless you set a tone, and colours the fill for the tone you set', () => {
    const { rerender } = render(<Meter label="Score" value={1} max={2} valueText="1 of 2" />);
    expect(fill().className).toContain('bg-accent');

    for (const tone of ['success', 'warning', 'danger'] as const) {
      rerender(<Meter label="Score" value={1} max={2} valueText="1 of 2" tone={tone} />);
      expect(fill().className).toContain(`bg-${tone}`);
    }
  });

  it('draws the track as a sunken fill', () => {
    render(<Meter label="Score" value={1} max={2} valueText="1 of 2" />);

    expect(screen.getByRole('meter').className).toContain('bg-sunken');
  });
});
